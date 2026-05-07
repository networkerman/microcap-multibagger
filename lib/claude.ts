import Anthropic from "@anthropic-ai/sdk";
import { SIGNALS, getBand, MAX_SCORE, BUSINESS_MODELS, type BusinessModel, type BusinessModelInfo } from "./signals";

// Three parallel groups. Each group independently classifies the business model
// and scores its subset of signals. Results are persisted as they arrive,
// giving the UI progressive data.
export const SIGNAL_GROUPS = [
  ["S3", "S4", "S10"],              // A — Primary (MOAT, OPM, Exponential)
  ["S1", "S2", "S9", "S12"],        // B — Financial/market visibility
  ["S5", "S6", "S7", "S8", "S11"], // C — Qualitative
] as const;

export interface SignalResult {
  signal_id: string;
  label: string;
  score: number;
  max_score: number;
  reasoning: string;
  sources: string[];
}

export interface AnalysisResult {
  signals: SignalResult[];
  total_score: number;
  max_score: number;
  band: string;
  summary: string;
  business_model: BusinessModel | null;
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

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

2. "Not applicable" is only permitted under the EXACT condition stated in each signal's "notApplicableCondition" field. You MUST provide specific, verified evidence that this condition is met. "Probably not applicable" is not valid — you must verify.

3. ORDER BOOK (S2) HAS AN ANALOGUE FOR EVERY BUSINESS MODEL EXCEPT PURE SPOT TRADING:
${s2Analogues}

4. When data is unavailable for a mandatory signal, score 1 (not 0) and state exactly what data you need. Scoring 0 means "I verified this fails the criteria" — not "I couldn't find the data."

5. Before writing "not applicable" for ANY signal, ask yourself:
   • Did I check the right data source for THIS specific business model?
   • Is there an analogue metric that serves the same analytical purpose?
   • Did I actually look, or am I assuming?

6. Score conservatively, but do not confuse "conservative" with "lazy." When evidence clearly supports a higher score, give it. When evidence clearly supports a lower score, give it. When evidence is genuinely unavailable, score 1.

─── BUSINESS MODEL CLASSIFICATION ───

Before scoring, you MUST classify the company into exactly one of these business models. This classification determines HOW each signal should be evaluated:

${modelList}

─── VERIFICATION METHODOLOGY ───

Your "reasoning" field for each signal MUST follow this structured format:
CHECKING: [specific data source you checked — screener.in, BSE filing, annual report, etc.]
FOUND: [specific number, fact, name, or "data not found in expected location"]
ANALOGUE: [if you used a business-model-specific analogue, state which and why; otherwise write "standard metric applied"]
SCORE: [brief explanation of why the evidence maps to this specific score per the scoring rubric]

─── JSON OUTPUT ───

Return ONLY valid JSON — no markdown fences, no preamble, no trailing text.
The JSON must be an array of signal objects. Include "business_model" as a string field alongside the array.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

const SUMMARY_SYSTEM = `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks on NSE and BSE.
You apply the Microcap Multibagger Framework — a signal-based scoring system to find policy-driven, high-growth smallcaps.
Write clearly and concisely in plain prose. Do not use JSON, markdown, bullet points, or headers.`;

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNAL GROUP ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

interface GroupAnalysisResponse {
  business_model: BusinessModel;
  signals: SignalResult[];
}

/**
 * Scores a subset of signals for one company. Called in parallel for each group.
 * @param dataContext Pre-fetched financial data from Screener.in — Claude MUST
 *   use these verified numbers rather than training-data guesses.
 * @returns The signal results and the business model classification.
 */
export async function analyzeSignalGroup(
  symbol: string,
  exchange: string,
  companyName: string,
  signalIds: readonly string[],
  dataContext = ""
): Promise<{ signals: SignalResult[]; businessModel: BusinessModel | null }> {
  const signals = SIGNALS
    .filter(s => signalIds.includes(s.id))
    .map(s => ({
      id: s.id,
      label: s.label,
      max: s.max,
      primary: s.primary ?? false,
      question: s.question,
      what: s.what,
      note: s.note,
      scoring: s.scoring,
      sources_to_check: s.source,
      pass_example: s.pass,
      fail_example: s.fail,
      // ─── NEW: Verification and applicability data ───
      not_applicable_condition: s.notApplicableCondition,
      verification_steps: s.verificationSteps.map(vs =>
        `Step ${vs.step}: ${vs.action} [Source: ${vs.source}] [Evidence: ${vs.evidenceRequired}]`
      ),
      analogues: s.applicability.analogues && Object.keys(s.applicability.analogues).length > 0
        ? Object.entries(s.applicability.analogues).map(([bm, analogue]) => `${bm}: ${analogue}`)
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
Return a single JSON object in exactly this shape (no markdown, no preamble):
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

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "{}";
  const json = text.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    // Try parsing as object with signals array + business_model
    const parsed = JSON.parse(json);

    if (parsed.signals && Array.isArray(parsed.signals)) {
      // New format: { business_model, signals: [...] }
      return {
        businessModel: parsed.business_model ?? null,
        signals: parsed.signals as SignalResult[],
      };
    }

    // Fallback: old format — plain array. Signals won't have business model.
    if (Array.isArray(parsed)) {
      return { businessModel: null, signals: parsed as SignalResult[] };
    }

    return { businessModel: null, signals: [] };
  } catch {
    return { businessModel: null, signals: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateSummary(
  symbol: string,
  exchange: string,
  companyName: string,
  signals: SignalResult[],
  band: string,
  total: number,
  max: number,
  dataContext = ""
): Promise<string> {
  const dataSection = dataContext ? `\n${dataContext}\n` : "";
  const prompt = `${companyName} (${symbol}, ${exchange}) scored ${total}/${max} — ${band}.
${dataSection}
Signal scores:
${signals.map(s => `${s.signal_id} ${s.label}: ${s.score}/${s.max_score} — ${s.reasoning}`).join("\n")}

Write a 3-5 sentence investment thesis summary: strongest signals, biggest risks, and overall conviction. Be specific and direct. Return plain text only.`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].type === "text" ? message.content[0].text.trim() : "";
}
