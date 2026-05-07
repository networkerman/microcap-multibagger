/**
 * Portfolio Analysis: Scores all stocks from the user's Zerodha holdings
 * through the 12-Signal Framework using DeepSeek.
 *
 * Usage: npx tsx scripts/analyze-portfolio.ts
 */

import * as fs from "fs";
import * as path from "path";

// ─── Load env ─────────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i === -1) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[k] = v;
}

import { createClient } from "@supabase/supabase-js";
import {
  SIGNALS, getBand, MAX_SCORE, BUSINESS_MODELS,
  type BusinessModel,
} from "../lib/signals";

// From lib/claude.ts — inlined to avoid Anthropic SDK import
const SIGNAL_GROUPS = [
  ["S3", "S4", "S10"],
  ["S1", "S2", "S9", "S12"],
  ["S5", "S6", "S7", "S8", "S11"],
] as const;
import { fetchScreenerData, formatScreenerContext } from "../lib/screener";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEEPSEEK_BASE = "https://api.deepseek.com/v1/chat/completions";
const CONCURRENCY = 6;

// Portfolio from holdings.csv — verified against Supabase instruments table
const PORTFOLIO: { symbol: string; exchange: string; name: string }[] = [
  { symbol: "AFCOM", exchange: "BSE", name: "Afcom Holdings" },
  { symbol: "AHLUCONT", exchange: "NSE", name: "Ahluwalia Contracts" },
  { symbol: "AIMTRON-SM", exchange: "NSE", name: "Aimtron Electronics" },
  { symbol: "BEL", exchange: "NSE", name: "Bharat Electronics" },
  { symbol: "BSE", exchange: "NSE", name: "BSE Ltd" },
  { symbol: "CANFINHOME", exchange: "NSE", name: "Can Fin Homes" },
  { symbol: "EMCURE", exchange: "NSE", name: "Emcure Pharmaceuticals" },
  { symbol: "ENDURANCE", exchange: "NSE", name: "Endurance Technologies" },
  { symbol: "ENTERO", exchange: "NSE", name: "Entero Healthcare" },
  { symbol: "FORCEMOT", exchange: "NSE", name: "Force Motors" },
  { symbol: "GENUSPOWER", exchange: "NSE", name: "Genus Power Infrastructure" },
  { symbol: "HDFCBANK", exchange: "NSE", name: "HDFC Bank" },
  { symbol: "HIRECT", exchange: "NSE", name: "Hind Rectifiers" },
  { symbol: "INDHOTEL", exchange: "NSE", name: "Indian Hotels" },
  { symbol: "KFINTECH", exchange: "NSE", name: "KFin Technologies" },
  { symbol: "KIMS", exchange: "NSE", name: "Krishna Institute of Medical Sciences" },
  { symbol: "KMEW", exchange: "NSE", name: "Knowledge Marine & Engineering" },
  { symbol: "KRN", exchange: "NSE", name: "KRN Heat Exchange" },
  { symbol: "LT", exchange: "NSE", name: "Larsen & Toubro" },
  { symbol: "LUMAXTECH", exchange: "NSE", name: "Lumax Auto Technologies" },
  { symbol: "M&M", exchange: "NSE", name: "Mahindra & Mahindra" },
  { symbol: "MARINE", exchange: "NSE", name: "Marine Electricals" },
  { symbol: "MAXHEALTH", exchange: "NSE", name: "Max Healthcare" },
  { symbol: "POLICYBZR", exchange: "NSE", name: "PB Fintech" },
  { symbol: "RELIANCE", exchange: "NSE", name: "Reliance Industries" },
  { symbol: "SEDEMAC", exchange: "NSE", name: "Sedemac Mechatronics" },
  { symbol: "SENCO", exchange: "NSE", name: "Senco Gold" },
  { symbol: "SOLARINDS", exchange: "NSE", name: "Solar Industries" },
  { symbol: "TARIL", exchange: "NSE", name: "Transformers & Rectifiers" },
  { symbol: "TECHNOE", exchange: "NSE", name: "Techno Electric & Engineering" },
  { symbol: "TRANSRAILL", exchange: "NSE", name: "Transrail Lighting" },
  { symbol: "UNIVASTU", exchange: "NSE", name: "Univastu India" },
  { symbol: "VENUSPIPES", exchange: "NSE", name: "Venus Pipes & Tubes" },
];

// ─── DeepSeek ─────────────────────────────────────────────────────────

async function deepseek(system: string, prompt: string, maxTokens = 4000): Promise<string> {
  const r = await fetch(DEEPSEEK_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`DeepSeek ${r.status}: ${err.slice(0, 200)}`);
  }
  const j = await r.json() as any;
  return j.choices[0].message.content;
}

// ─── System prompt (mirrors lib/claude.ts) ───────────────────────────

function buildSystemPrompt(): string {
  const s2Analogues = BUSINESS_MODELS.map(m => `  • ${m.label}: ${m.s2Analogue}`).join("\n");

  return `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks on NSE and BSE.
You apply the Microcap Multibagger Framework — a signal-based scoring system to find policy-driven, high-growth smallcaps.

⛔ CRITICAL ANTI-SKIP RULES:
1. EVERY signal in your group MUST be scored. You may NOT skip any signal.
2. "Not applicable" requires EXPLICIT evidence — not assumption.
3. ORDER BOOK (S2) HAS AN ANALOGUE FOR EVERY BUSINESS MODEL EXCEPT PURE SPOT TRADING:
${s2Analogues}
4. When data is unavailable, score 1 (not 0) and state what data you need.
5. Score conservatively, but do not confuse "conservative" with "lazy."

─── BUSINESS MODEL CLASSIFICATION ───
${BUSINESS_MODELS.map(m => `  • ${m.label} (${m.id}): ${m.description}`).join("\n")}

─── VERIFICATION ───
Reasoning MUST follow: CHECKING: [source] / FOUND: [data] / ANALOGUE: [if any] / SCORE: [why]

─── OUTPUT ───
Return ONLY valid JSON — no markdown, no preamble.`;
}

// ─── Score one signal group ───────────────────────────────────────────

interface SignalResult {
  signal_id: string; label: string; score: number; max_score: number;
  reasoning: string; sources: string[];
}

async function scoreGroup(
  symbol: string, exchange: string, companyName: string,
  signalIds: readonly string[], dataContext: string
): Promise<{ signals: SignalResult[]; businessModel: BusinessModel | null }> {
  const signals = SIGNALS.filter(s => signalIds.includes(s.id)).map(s => ({
    id: s.id, label: s.label, max: s.max, primary: s.primary ?? false,
    question: s.question, what: s.what, note: s.note, scoring: s.scoring,
    sources_to_check: s.source, pass_example: s.pass, fail_example: s.fail,
    not_applicable_condition: s.notApplicableCondition,
    verification_steps: s.verificationSteps.map(vs =>
      `Step ${vs.step}: ${vs.action} [Source: ${vs.source}] [Evidence: ${vs.evidenceRequired}]`
    ),
    analogues: s.applicability.analogues && Object.keys(s.applicability.analogues).length > 0
      ? Object.entries(s.applicability.analogues).map(([bm, a]) => `${bm}: ${a}`) : undefined,
  }));

  const dataSection = dataContext ? `\n${dataContext}\n\nUse the verified data above as primary source.\n` : "";

  const prompt = `Analyse: ${companyName} (${symbol}, ${exchange})
${dataSection}
1. Classify this company's business model.
2. Score ALL ${signals.length} signals.

Signals: ${JSON.stringify(signals, null, 2)}

Return JSON: { "business_model": "<${BUSINESS_MODELS.map(m => m.id).join('|')}>", "signals": [ { "signal_id": "...", "label": "...", "score": N, "max_score": N, "reasoning": "CHECKING: ...\\nFOUND: ...\\nANALOGUE: ...\\nSCORE: ...", "sources": [...] } ] }`;

  const text = await deepseek(buildSystemPrompt(), prompt, 4000);
  const json = text.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    const parsed = JSON.parse(json);
    if (parsed.signals && Array.isArray(parsed.signals)) {
      return { businessModel: parsed.business_model ?? null, signals: parsed.signals as SignalResult[] };
    }
    if (Array.isArray(parsed)) return { businessModel: null, signals: parsed as SignalResult[] };
    return { businessModel: null, signals: [] };
  } catch { return { businessModel: null, signals: [] }; }
}

// ─── Summary ──────────────────────────────────────────────────────────

async function generateSummary(
  symbol: string, exchange: string, companyName: string,
  signals: SignalResult[], band: string, total: number, dataContext: string
): Promise<string> {
  const dataSection = dataContext ? `\n${dataContext}\n` : "";
  const prompt = `${companyName} (${symbol}, ${exchange}) scored ${total}/${MAX_SCORE} — ${band}.
${dataSection}
Signal scores:
${signals.map(s => `${s.signal_id} ${s.label}: ${s.score}/${s.max_score} — ${s.reasoning}`).join("\n")}

Write a 3-5 sentence investment thesis summary. Be specific and direct. Plain text only.`;

  return deepseek(
    "You are an expert Indian stock market analyst. Write clearly in plain prose. No JSON, no markdown.",
    prompt, 400
  );
}

// ─── Process one stock ────────────────────────────────────────────────

async function analyzeStock(sym: string, exchange: string, companyName: string) {
  // Fetch Screener data
  let dataContext = "";
  try { const sd = await fetchScreenerData(sym, exchange); if (sd) dataContext = formatScreenerContext(sd); } catch {}

  // 3 parallel groups
  const results = await Promise.all(
    SIGNAL_GROUPS.map(group => scoreGroup(sym, exchange, companyName, group, dataContext))
  );

  const allSignals = results.flatMap(r => r.signals);
  const businessModel = results.find(r => r.businessModel)?.businessModel ?? null;
  const total = allSignals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total);

  // Summary
  let summary = "";
  try { summary = await generateSummary(sym, exchange, companyName, allSignals, band.label, total, dataContext); } catch {}

  // Upsert report
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: report, error: upsertErr } = await supabase.from("reports")
    .upsert({ symbol: sym, exchange, company_name: companyName, status: "analyzing", expires_at: expiresAt }, { onConflict: "symbol,exchange" })
    .select().single();

  if (upsertErr || !report) throw new Error("upsert failed");

  // Replace signals
  await supabase.from("report_signals").delete().eq("report_id", report.id);
  if (allSignals.length > 0) {
    await supabase.from("report_signals").insert(allSignals.map(s => ({
      report_id: report.id, signal_id: s.signal_id, label: s.label,
      score: s.score, max_score: s.max_score, reasoning: s.reasoning, sources: s.sources,
    })));
  }

  // Finalize
  await supabase.from("reports").update({
    status: "complete", total_score: total, max_score: MAX_SCORE,
    band: band.label, summary, business_model: businessModel, analyzed_at: new Date().toISOString(),
  }).eq("id", report.id);

  return { symbol: sym, exchange, total, band: band.label, businessModel, signalCount: allSignals.length };
}

// ─── Main ─────────────────────────────────────────────────────────────

const BAND_ICON: Record<string, string> = { "STRONG BUY": "🟢", "WATCHLIST": "🟡", "INVESTIGATE": "🟠", "AVOID": "🔴" };

async function main() {
  console.log(`\n🔬 Analysing ${PORTFOLIO.length} portfolio stocks with 12-Signal Framework v2.0\n`);
  console.log("─".repeat(72));

  const results: Awaited<ReturnType<typeof analyzeStock>>[] = [];
  const start = Date.now();

  for (let i = 0; i < PORTFOLIO.length; i += CONCURRENCY) {
    const batch = PORTFOLIO.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((p, idx) =>
        new Promise<Awaited<ReturnType<typeof analyzeStock>>>(resolve =>
          setTimeout(() => analyzeStock(p.symbol, p.exchange, p.name).then(resolve), idx * 400)
        )
      )
    );

    for (let j = 0; j < batch.length; j++) {
      const r = batchResults[j];
      const p = batch[j];
      if (r.status === "fulfilled") {
        const { total, band, businessModel, signalCount } = r.value;
        results.push(r.value);
        const icon = BAND_ICON[band] || "⚪";
        const bm = businessModel ? ` [${businessModel}]` : "";
        console.log(`${icon} ${p.symbol.padEnd(14)} ${String(total).padStart(2)}/${MAX_SCORE}  ${band.padEnd(14)} ${signalCount}/12 sigs${bm}`);
      } else {
        console.log(`❌ ${p.symbol.padEnd(14)} FAILED: ${String(r.reason).slice(0, 50)}`);
      }
    }

    const done = Math.min(i + CONCURRENCY, PORTFOLIO.length);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`─ ${done}/${PORTFOLIO.length} done · ${elapsed}s`);
  }

  // Summary
  const totalSec = Math.round((Date.now() - start) / 1000);
  const bands: Record<string, number> = {};
  for (const r of results) bands[r.band] = (bands[r.band] || 0) + 1;

  console.log(`\n✅ All ${results.length} analysed in ${totalSec}s\n`);
  console.log("PORTFOLIO SUMMARY");
  console.log("─".repeat(72));
  for (const [band, count] of Object.entries(bands)) {
    console.log(`  ${BAND_ICON[band] || "⚪"} ${band.padEnd(14)} ${count} stocks (${Math.round(count / results.length * 100)}%)`);
  }

  const avgScore = Math.round(results.reduce((a, r) => a + r.total, 0) / results.length);
  console.log(`\n  Portfolio average: ${avgScore}/${MAX_SCORE}`);

  // Sorted leaderboard
  console.log("\nYOUR PORTFOLIO LEADERBOARD");
  console.log("─".repeat(72));
  const sorted = [...results].sort((a, b) => b.total - a.total);
  for (const r of sorted) {
    const icon = BAND_ICON[r.band] || "⚪";
    const bm = r.businessModel ? ` [${r.businessModel}]` : "";
    console.log(`${icon} ${r.symbol.padEnd(14)} ${r.exchange}  ${String(r.total).padStart(2)}/${MAX_SCORE}  ${r.band.padEnd(14)}${bm}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
