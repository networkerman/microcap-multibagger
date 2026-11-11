import Anthropic from "@anthropic-ai/sdk";
import { SIGNALS, BUSINESS_MODELS, type BusinessModel } from "./signals";

// Three parallel groups. Each group independently classifies the business model
// and scores its subset of signals. Results are persisted as they arrive,
// giving the UI progressive data.
export const SIGNAL_GROUPS = [
  ["S1"], ["S2"], ["S3"], ["S4"], ["S5"], ["S6"],
  ["S7"], ["S8"], ["S9"], ["S10"], ["S11"], ["S12"],
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
// MODEL
// ═══════════════════════════════════════════════════════════════════════════════

export const ANALYSIS_MODEL = "claude-fable-5-2";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

// Thinking depth for signal scoring and deep analysis. Override with ANALYSIS_EFFORT.
function analysisEffort(): Effort {
  const e = process.env.ANALYSIS_EFFORT as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : "medium";
}

// Running token totals for this process, so batch scripts can report spend.
export const usageTotals = { calls: 0, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0 };

/**
 * One request to the analysis model. Thinking is always on for this model and
 * counts against max_tokens, so budgets here are far larger than the visible
 * answer. Streams so long thinking turns don't hit HTTP timeouts.
 * Pass `schema` to get JSON that is guaranteed to match it.
 */
async function ask(opts: {
  system: string;
  prompt: string;
  maxTokens: number;
  effort: Effort;
  schema?: Record<string, unknown>;
  /** Text placed before the prompt and cached, so later calls that share it read it at a fraction of the price. */
  cachedPrefix?: string;
}): Promise<string> {
  const message = await getClient().beta.messages.stream({
    model: ANALYSIS_MODEL,
    max_tokens: opts.maxTokens,
    // If a safety classifier declines the request, the API re-runs it on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: opts.effort,
      ...(opts.schema ? { format: { type: "json_schema" as const, schema: opts.schema } } : {}),
    },
    system: opts.system,
    messages: [{
      role: "user",
      content: opts.cachedPrefix
        ? [
            { type: "text", text: opts.cachedPrefix, cache_control: { type: "ephemeral" } },
            { type: "text", text: opts.prompt },
          ]
        : opts.prompt,
    }],
  }).finalMessage();

  usageTotals.calls += 1;
  usageTotals.input_tokens += message.usage.input_tokens;
  usageTotals.output_tokens += message.usage.output_tokens;
  usageTotals.cache_write_tokens += message.usage.cache_creation_input_tokens ?? 0;
  usageTotals.cache_read_tokens += message.usage.cache_read_input_tokens ?? 0;

  if (message.stop_reason === "refusal") {
    throw new Error(`Model declined the request (${message.stop_details?.category ?? "no category"})`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(`Response truncated at max_tokens=${opts.maxTokens}`);
  }
  return message.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("").trim();
}

const SIGNAL_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["business_model", "signals"],
  properties: {
    business_model: { type: "string", enum: BUSINESS_MODELS.map(m => m.id) },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["signal_id", "label", "score", "max_score", "reasoning", "sources"],
        properties: {
          signal_id: { type: "string" },
          label: { type: "string" },
          score: { type: "integer" },
          max_score: { type: "integer" },
          reasoning: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const DEEP_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions", "overall_verdict"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "answer"],
        properties: { number: { type: "integer" }, answer: { type: "string" } },
      },
    },
    overall_verdict: { type: "string" },
  },
};

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

Return a single JSON object with "business_model" (string) and "signals" (array), in the shape given in the task.`;
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
  dataContext = "",
  /** Cache the company data across calls. Only pays off when one call finishes before the rest start. */
  cacheContext = false
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

  const header = `Analyse: ${companyName} (${symbol}, ${exchange})
${dataSection}`;
  const task = `─── TASK ───
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

  const text = await ask({
    system: buildSystemPrompt(),
    ...(cacheContext ? { cachedPrefix: header, prompt: task } : { prompt: header + "\n" + task }),
    maxTokens: 16000,
    effort: analysisEffort(),
    schema: SIGNAL_RESPONSE_SCHEMA,
  });

  const parsed = JSON.parse(text) as GroupAnalysisResponse;

  // Trust the framework definition, not the model, for label and max; keep
  // scores inside the rubric's range and drop anything that wasn't asked for.
  const defs = new Map(SIGNALS.filter(s => signalIds.includes(s.id)).map(s => [s.id, s]));
  const seen = new Set<string>();
  const cleaned: SignalResult[] = [];
  for (const r of parsed.signals) {
    const def = defs.get(r.signal_id);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    cleaned.push({
      signal_id: def.id,
      label: def.label,
      score: Math.min(def.max, Math.max(0, Math.round(r.score))),
      max_score: def.max,
      reasoning: r.reasoning,
      sources: r.sources ?? [],
    });
  }
  return { businessModel: parsed.business_model ?? null, signals: cleaned };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 15-QUESTION DEEP ANALYSIS (Vishal Khandelwal / Safal Niveshak framework)
// ═══════════════════════════════════════════════════════════════════════════════

export interface QuestionAnswer {
  category: "business" | "management" | "price";
  number: number;
  question: string;
  timeref: string;
  answer: string;
}

export interface DeepAnalysisResult {
  symbol: string;
  exchange: string;
  company_name: string;
  questions: QuestionAnswer[];
  overall_verdict: string;
  created_at: string;
}

const DEEP_ANALYSIS_QUESTIONS: Omit<QuestionAnswer, "answer">[] = [
  { category: "business", number: 1,  question: "What does this company actually do? Can you explain it in plain language without jargon?", timeref: "Clarity test" },
  { category: "business", number: 2,  question: "How do they make money and from whom? Who are the customers and why do they pay? What are the gross, operating, and net margins?", timeref: "Revenue model" },
  { category: "business", number: 3,  question: "Would you be honest about whether you truly understand this business, or are you pretending to? What would you ask the CEO?", timeref: "Honesty check" },
  { category: "business", number: 4,  question: "Would a long-term investor be happy owning this for 10 years if the market shut down tomorrow? Is the business structurally sound enough to compound value independently of stock price?", timeref: "Conviction test" },
  { category: "business", number: 5,  question: "What could kill this business? List the existential risks — technology disruption, regulatory change, competition, shifting customer habits. Be honest and specific.", timeref: "Risk inventory" },
  { category: "management", number: 6,  question: "Would you trust this management team with your family's savings? Assess integrity, transparency, and governance based on their track record.", timeref: "Trust test" },
  { category: "management", number: 7,  question: "How do they treat minority shareholders? Look for related party transactions, promoter pledging, excessive management compensation, dilutive capital raises, or tunneling.", timeref: "Minority rights" },
  { category: "management", number: 8,  question: "What do the last 5–10 years of capital allocation decisions tell you? Have they created value through reinvestment, or destroyed it through bad acquisitions, vanity projects, or excessive debt?", timeref: "Capital allocation" },
  { category: "management", number: 9,  question: "Do they tell the truth in good years and bad? Read the MD&A from their worst year. Did they take accountability or blame external factors?", timeref: "Accountability check" },
  { category: "management", number: 10, question: "Do they have real skin in the game? What is the promoter holding %? Is there pledging? Do they buy more on dips? Is their personal wealth aligned with minority shareholders?", timeref: "Alignment check" },
  { category: "price", number: 11, question: "What are you paying today? State the current P/E, P/FCF, EV/EBITDA, or P/BV (for financials) and compare them against historical averages and sector peers.", timeref: "Current valuation" },
  { category: "price", number: 12, question: "What is the market implicitly expecting in terms of growth, margin expansion, and duration? Does the current price embed a realistic or fantasy narrative?", timeref: "Implied story" },
  { category: "price", number: 13, question: "What would a rational private buyer pay for 100% of this business today? Strip away market hype — what is the intrinsic value based on cash flows and assets?", timeref: "Private buyer test" },
  { category: "price", number: 14, question: "At what price would you sell, and why? Define the exit triggers — overvaluation, fundamental deterioration, better capital allocation opportunity — before emotions take over.", timeref: "Exit discipline" },
  { category: "price", number: 15, question: "If the stock drops 40% tomorrow with no change in fundamentals, do you buy more or panic-sell? Your honest answer reveals whether you truly own the business or the ticker.", timeref: "Conviction stress test" },
];

const DEEP_ANALYSIS_SYSTEM = `You are an expert Indian equity analyst applying the Vishal Khandelwal (Safal Niveshak) investor thinking framework to evaluate stocks.

Your job is to answer each question with specific, grounded facts about this company — using data from Screener.in, BSE/NSE filings, annual reports, MD&A sections, SEBI disclosures, and public research.

Rules:
1. Be direct, honest, and specific. Use actual numbers, dates, and company-specific evidence.
2. Do NOT give generic answers. Every answer must reference this specific company's facts.
3. If data is unavailable for a sub-question, say so explicitly — do not fabricate.
4. Be intellectually honest — if a question reveals a red flag, state it clearly.
5. Length per answer: 4–8 sentences. Dense with facts, not padded with platitudes.
6. For the overall_verdict: 2–3 sentences summarising the honest investment case.

Return a single JSON object in the shape given in the task.`;

export async function runDeepAnalysis(
  symbol: string,
  exchange: string,
  companyName: string,
  screenerContext = ""
): Promise<DeepAnalysisResult> {
  const t0 = Date.now();
  console.log(`[claude:deep-analysis] Starting for ${exchange}:${symbol}`);

  const dataSection = screenerContext
    ? `\nVERIFIED FINANCIAL DATA (use as primary source):\n${screenerContext}\n`
    : "";

  const prompt = `Analyse: ${companyName} (${symbol}, ${exchange})
${dataSection}
Answer each of the following 15 questions about this specific company. Return a JSON object with this exact shape:

{
  "questions": [
    { "number": 1, "answer": "..." },
    ...
    { "number": 15, "answer": "..." }
  ],
  "overall_verdict": "2-3 sentence honest investment verdict based on all 15 answers."
}

The 15 questions:
${DEEP_ANALYSIS_QUESTIONS.map(q => `Q${q.number} (${q.timeref}): ${q.question}`).join("\n")}`;

  const raw = await ask({
    system: DEEP_ANALYSIS_SYSTEM,
    prompt,
    maxTokens: 32000,
    effort: analysisEffort(),
    schema: DEEP_ANALYSIS_SCHEMA,
  });
  console.log(`[claude:deep-analysis] Response in ${((Date.now() - t0) / 1000).toFixed(1)}s | ${raw.length} chars`);

  const parsed = JSON.parse(raw) as { questions: { number: number; answer: string }[]; overall_verdict: string };

  const answerMap = new Map(parsed.questions.map(q => [q.number, q.answer]));

  return {
    symbol,
    exchange,
    company_name: companyName,
    questions: DEEP_ANALYSIS_QUESTIONS.map(q => ({
      ...q,
      answer: answerMap.get(q.number) ?? "Analysis not available for this question.",
    })),
    overall_verdict: parsed.overall_verdict ?? "",
    created_at: new Date().toISOString(),
  };
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

  return ask({ system: SUMMARY_SYSTEM, prompt, maxTokens: 4000, effort: "low" });
}
