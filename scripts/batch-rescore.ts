/**
 * Batch re-scores ALL completed reports using DeepSeek API.
 *
 * Reads .env.local for Supabase + DeepSeek creds, fetches every completed
 * report, re-runs the 12-signal analysis through DeepSeek (OpenAI-compatible),
 * and writes updated scores back to Supabase.
 *
 * Usage:  npx tsx scripts/batch-rescore.ts
 * Env:    DEEPSEEK_API_KEY must be set in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// ─── Load .env.local ─────────────────────────────────────────────────────

const envPath = path.resolve(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  // Strip surrounding quotes (single or double)
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val;
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_KEY) {
  console.error("❌ DEEPSEEK_API_KEY not found in .env.local");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Imports (after env loading so module-level env reads work) ──────────
import {
  SIGNALS, getBand, MAX_SCORE, BUSINESS_MODELS,
  type BusinessModel,
} from "../lib/signals";
import { fetchScreenerData, formatScreenerContext } from "../lib/screener";

// Inlined from lib/claude.ts to avoid importing the Anthropic SDK
const SIGNAL_GROUPS = [
  ["S3", "S4", "S10"],              // A — Primary (MOAT, OPM, Exponential)
  ["S1", "S2", "S9", "S12"],        // B — Financial/market visibility
  ["S5", "S6", "S7", "S8", "S11"], // C — Qualitative
] as const;

interface SignalResult {
  signal_id: string;
  label: string;
  score: number;
  max_score: number;
  reasoning: string;
  sources: string[];
}

// ─── DeepSeek API ────────────────────────────────────────────────────────

const DEEPSEEK_BASE = "https://api.deepseek.com/v1/chat/completions";

async function deepseekChat(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4000,
  temperature = 0
): Promise<string> {
  const res = await fetch(DEEPSEEK_BASE, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DEEPSEEK_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0].message.content;
}

// ─── Prompt builders (mirrors lib/claude.ts) ─────────────────────────────

function buildSystemPrompt(): string {
  const modelList = BUSINESS_MODELS.map(m =>
    `  • ${m.label} (${m.id}): ${m.description} Examples: ${m.examples}`
  ).join("\n");

  const s2Analogues = BUSINESS_MODELS.map(m =>
    `  • ${m.label}: ${m.s2Analogue}`
  ).join("\n");

  return `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks on NSE and BSE.
You apply the Microcap Multibagger Framework — a signal-based scoring system to find policy-driven, high-growth smallcaps.

Sources to check: screener.in, bseindia.com, nseindia.com, CRISIL/ICRA/CARE/India Ratings press releases, Glassdoor, LinkedIn, NITI Aayog documents, Budget speeches, company annual reports, investor presentations.

⛔ CRITICAL ANTI-SKIP RULES — VIOLATING ANY OF THESE INVALIDATES THE ANALYSIS:

1. EVERY signal in your group MUST be scored. You may NOT skip any signal. A score of 0 is a valid score, but it requires VERIFIED evidence of failure/absence — not an assumption.

2. "Not applicable" is only permitted under the EXACT condition stated in each signal's "notApplicableCondition" field. You MUST provide specific, verified evidence that this condition is met.

3. ORDER BOOK (S2) HAS AN ANALOGUE FOR EVERY BUSINESS MODEL EXCEPT PURE SPOT TRADING:
${s2Analogues}

4. When data is unavailable for a mandatory signal, score 1 (not 0) and state exactly what data you need. Scoring 0 means "I verified this fails the criteria" — not "I couldn't find the data."

5. Before writing "not applicable" for ANY signal, ask yourself:
   • Did I check the right data source for THIS specific business model?
   • Is there an analogue metric that serves the same analytical purpose?
   • Did I actually look, or am I assuming?

6. Score conservatively, but do not confuse "conservative" with "lazy."

─── BUSINESS MODEL CLASSIFICATION ───

Before scoring, you MUST classify the company into exactly one of these business models:
${modelList}

─── VERIFICATION METHODOLOGY ───

Your "reasoning" field for each signal MUST follow this structured format:
CHECKING: [specific data source you checked]
FOUND: [specific number, fact, or "data not found in expected location"]
ANALOGUE: [if you used a business-model-specific analogue, state which; otherwise "standard metric applied"]
SCORE: [why the evidence maps to this specific score per the scoring rubric]

─── JSON OUTPUT ───
Return ONLY valid JSON — no markdown fences, no preamble, no trailing text.`;
}

// ─── Signal group analysis (DeepSeek version) ───────────────────────────

async function scoreSignalGroup(
  symbol: string, exchange: string, companyName: string,
  signalIds: readonly string[], dataContext: string
): Promise<{ signals: SignalResult[]; businessModel: BusinessModel | null }> {
  const signals = SIGNALS
    .filter(s => signalIds.includes(s.id))
    .map(s => ({
      id: s.id, label: s.label, max: s.max,
      primary: s.primary ?? false,
      question: s.question, what: s.what, note: s.note,
      scoring: s.scoring,
      sources_to_check: s.source,
      pass_example: s.pass, fail_example: s.fail,
      not_applicable_condition: s.notApplicableCondition,
      verification_steps: s.verificationSteps.map(vs =>
        `Step ${vs.step}: ${vs.action} [Source: ${vs.source}] [Evidence: ${vs.evidenceRequired}]`
      ),
      analogues: s.applicability.analogues && Object.keys(s.applicability.analogues).length > 0
        ? Object.entries(s.applicability.analogues).map(([bm, a]) => `${bm}: ${a}`)
        : undefined,
      mandatory_for: s.applicability.mandatory.join(", "),
      not_applicable_for: s.applicability.notApplicable.join(", "),
    }));

  const dataSection = dataContext
    ? `\n${dataContext}\n\nUse the verified data above as your primary source. Do not contradict these numbers.\n`
    : "";

  const prompt = `Analyse: ${companyName} (${symbol}, ${exchange})
${dataSection}
─── TASK ───
1. Classify this company's business model from the list in the system prompt.
2. Score ALL ${signals.length} of the following signals using the verification steps defined for each.
3. Return a JSON object with "business_model" (string) and "signals" (array).

─── SIGNALS TO SCORE ───
${JSON.stringify(signals, null, 2)}

─── REQUIRED RESPONSE FORMAT ───
Return a single JSON object (no markdown, no preamble):
{
  "business_model": "<one of: ${BUSINESS_MODELS.map(m => m.id).join(" | ")}>",
  "signals": [
    {
      "signal_id": "S3",
      "label": "MOAT & Entry Barriers",
      "score": <integer 0 to max>,
      "max_score": <max from signal def>,
      "reasoning": "CHECKING: ...\\nFOUND: ...\\nANALOGUE: ...\\nSCORE: ...",
      "sources": ["<source name or URL>"]
    }
  ]
}`;

  const text = await deepseekChat(buildSystemPrompt(), prompt, 4000, 0.1);
  const json = text.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    const parsed = JSON.parse(json);
    if (parsed.signals && Array.isArray(parsed.signals)) {
      return {
        businessModel: parsed.business_model ?? null,
        signals: parsed.signals as SignalResult[],
      };
    }
    if (Array.isArray(parsed)) {
      return { businessModel: null, signals: parsed as SignalResult[] };
    }
    return { businessModel: null, signals: [] };
  } catch {
    return { businessModel: null, signals: [] };
  }
}

async function generateSummary(
  symbol: string, exchange: string, companyName: string,
  signals: SignalResult[], band: string, total: number, dataContext: string
): Promise<string> {
  const dataSection = dataContext ? `\n${dataContext}\n` : "";
  const prompt = `${companyName} (${symbol}, ${exchange}) scored ${total}/${MAX_SCORE} — ${band}.
${dataSection}
Signal scores:
${signals.map(s => `${s.signal_id} ${s.label}: ${s.score}/${s.max_score} — ${s.reasoning}`).join("\n")}

Write a 3-5 sentence investment thesis summary: strongest signals, biggest risks, and overall conviction. Be specific and direct. Return plain text only.`;

  const systemPrompt = `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks.
Write clearly and concisely in plain prose. Do not use JSON, markdown, bullet points, or headers.`;

  return deepseekChat(systemPrompt, prompt, 400, 0.4);
}

// ─── Process a single stock ──────────────────────────────────────────────

interface ReportRow {
  id: string;
  symbol: string;
  exchange: string;
  company_name: string;
}

async function rescoreStock(report: ReportRow): Promise<{
  symbol: string; exchange: string; total: number; band: string; bm: string | null;
}> {
  const { id, symbol, exchange, company_name: companyName } = report;

  // 1. Fetch fresh Screener.in data
  let dataContext = "";
  try {
    const sd = await fetchScreenerData(symbol, exchange);
    if (sd) dataContext = formatScreenerContext(sd);
  } catch { /* proceed without Screener data */ }

  // 2. Score 3 signal groups in parallel
  const results = await Promise.all(
    SIGNAL_GROUPS.map(group =>
      scoreSignalGroup(symbol, exchange, companyName, group, dataContext)
    )
  );

  const allSignals = results.flatMap(r => r.signals);
  const businessModel = results.find(r => r.businessModel)?.businessModel ?? null;
  const totalScore = allSignals.reduce((a, s) => a + s.score, 0);
  const band = getBand(totalScore);

  // 3. Generate summary
  let summary = "";
  try {
    summary = await generateSummary(symbol, exchange, companyName, allSignals, band.label, totalScore, dataContext);
  } catch { /* non-fatal */ }

  // 4. Update Supabase: delete old signals → insert new → update report
  await supabase.from("report_signals").delete().eq("report_id", id);

  if (allSignals.length > 0) {
    await supabase.from("report_signals").insert(
      allSignals.map(s => ({
        report_id: id,
        signal_id: s.signal_id,
        label: s.label,
        score: s.score,
        max_score: s.max_score,
        reasoning: s.reasoning,
        sources: s.sources,
      }))
    );
  }

  await supabase.from("reports").update({
    status: "complete",
    total_score: totalScore,
    max_score: MAX_SCORE,
    band: band.label,
    summary,
    business_model: businessModel,
    analyzed_at: new Date().toISOString(),
  }).eq("id", id);

  return { symbol, exchange, total: totalScore, band: band.label, bm: businessModel };
}

// ─── Main ────────────────────────────────────────────────────────────────

const CONCURRENCY = 8;

async function main() {
  console.log("🔍 Fetching completed reports from Supabase...\n");

  const { data: reports } = await supabase
    .from("reports")
    .select("id, symbol, exchange, company_name, status")
    .eq("status", "complete")
    .order("total_score", { ascending: false });

  if (!reports || reports.length === 0) {
    console.log("No completed reports found.");
    return;
  }

  console.log(`Found ${reports.length} completed reports. Processing ${CONCURRENCY} at a time.\n`);
  console.log("─".repeat(70));

  const startTime = Date.now();
  let done = 0;

  // Process in concurrent batches
  for (let i = 0; i < reports.length; i += CONCURRENCY) {
    const batch = reports.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((r, idx) => {
        // Stagger slightly within batch to avoid thundering herd on DeepSeek
        return new Promise<Awaited<ReturnType<typeof rescoreStock>>>((resolve, reject) =>
          setTimeout(() => rescoreStock(r).then(resolve, reject), idx * 500)
        );
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      const stock = batch[j];
      if (result.status === "fulfilled") {
        const { total, band, bm } = result.value;
        const bmTag = bm ? ` [${bm}]` : "";
        const icon = band === "STRONG BUY" ? "🟢" : band === "WATCHLIST" ? "🟡" : band === "INVESTIGATE" ? "🟠" : "🔴";
        console.log(`${icon} ${stock.symbol.padEnd(12)} ${stock.exchange}  ${String(total).padStart(2)}/${MAX_SCORE}  ${band.padEnd(14)}${bmTag}`);
      } else {
        console.log(`❌ ${stock.symbol.padEnd(12)} ${stock.exchange}  FAILED: ${String(result.reason).slice(0, 60)}`);
      }
    }

    done += batch.length;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`─ ${done}/${reports.length} done · ${elapsed}s elapsed`);
  }

  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ All ${done} reports re-scored in ${totalSec}s`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
