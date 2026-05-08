// DeepSeek API client — OpenAI-compatible endpoint
//
// DeepSeek is the DEFAULT provider for backend heavy lifting:
//   - 12-signal scoring (the expensive 3-parallel-group analysis)
//   - 15-question investor deep analysis (Vishal Khandelwal framework)
//   - Batch re-scoring and portfolio analysis
//
// Claude (lib/claude.ts) is reserved for:
//   - Summary generation (cheap, creative writing)
//   - UI/UX design and visual creative work
//
// Strategy: DEEPSEEK_API_KEY is REQUIRED for production on Vercel.
// If missing, falls back to Claude for signal scoring (more expensive).

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

const QUESTIONS: Omit<QuestionAnswer, "answer">[] = [
  // Business
  { category: "business", number: 1, question: "What does this company actually do? Can you explain it in plain language without jargon?", timeref: "Clarity test" },
  { category: "business", number: 2, question: "How do they make money and from whom? Who are the customers and why do they pay? What are the gross, operating, and net margins?", timeref: "Revenue model" },
  { category: "business", number: 3, question: "Would you be honest about whether you truly understand this business, or are you pretending to? What would you ask the CEO?", timeref: "Honesty check" },
  { category: "business", number: 4, question: "Would a long-term investor be happy owning this for 10 years if the market shut down tomorrow? Is the business structurally sound enough to compound value independently of stock price?", timeref: "Conviction test" },
  { category: "business", number: 5, question: "What could kill this business? List the existential risks — technology disruption, regulatory change, competition, shifting customer habits. Be honest and specific.", timeref: "Risk inventory" },
  // Management
  { category: "management", number: 6, question: "Would you trust this management team with your family's savings? Assess integrity, transparency, and governance based on their track record.", timeref: "Trust test" },
  { category: "management", number: 7, question: "How do they treat minority shareholders? Look for related party transactions, promoter pledging, excessive management compensation, dilutive capital raises, or tunneling.", timeref: "Minority rights" },
  { category: "management", number: 8, question: "What do the last 5–10 years of capital allocation decisions tell you? Have they created value through reinvestment, or destroyed it through bad acquisitions, vanity projects, or excessive debt?", timeref: "Capital allocation" },
  { category: "management", number: 9, question: "Do they tell the truth in good years and bad? Read the MD&A from their worst year. Did they take accountability or blame external factors?", timeref: "Accountability check" },
  { category: "management", number: 10, question: "Do they have real skin in the game? What is the promoter holding %? Is there pledging? Do they buy more on dips? Is their personal wealth aligned with minority shareholders?", timeref: "Alignment check" },
  // Price
  { category: "price", number: 11, question: "What are you paying today? State the current P/E, P/FCF, EV/EBITDA, or P/BV (for financials) and compare them against historical averages and sector peers.", timeref: "Current valuation" },
  { category: "price", number: 12, question: "What is the market implicitly expecting in terms of growth, margin expansion, and duration? Does the current price embed a realistic or fantasy narrative?", timeref: "Implied story" },
  { category: "price", number: 13, question: "What would a rational private buyer pay for 100% of this business today? Strip away market hype — what is the intrinsic value based on cash flows and assets?", timeref: "Private buyer test" },
  { category: "price", number: 14, question: "At what price would you sell, and why? Define the exit triggers — overvaluation, fundamental deterioration, better capital allocation opportunity — before emotions take over.", timeref: "Exit discipline" },
  { category: "price", number: 15, question: "If the stock drops 40% tomorrow with no change in fundamentals, do you buy more or panic-sell? Your honest answer reveals whether you truly own the business or the ticker.", timeref: "Conviction stress test" },
];

const SYSTEM_PROMPT = `You are an expert Indian equity analyst applying the Vishal Khandelwal (Safal Niveshak) investor thinking framework to evaluate stocks.

Your job is to answer each question with specific, grounded facts about this company — using data from Screener.in, BSE/NSE filings, annual reports, MD&A sections, SEBI disclosures, and public research.

Rules:
1. Be direct, honest, and specific. Use actual numbers, dates, and company-specific evidence.
2. Do NOT give generic answers. Every answer must reference this specific company's facts.
3. If data is unavailable for a sub-question, say so explicitly — do not fabricate.
4. Be intellectually honest — if a question reveals a red flag, state it clearly.
5. Length per answer: 4–8 sentences. Dense with facts, not padded with platitudes.
6. For the overall_verdict: 2–3 sentences summarising the honest investment case.

Return ONLY a valid JSON object — no markdown fences, no preamble.`;

export async function runDeepAnalysis(
  symbol: string,
  exchange: string,
  companyName: string,
  screenerContext = ""
): Promise<DeepAnalysisResult> {
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
${QUESTIONS.map(q => `Q${q.number} (${q.timeref}): ${q.question}`).join("\n")}`;

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-reasoner",
      max_tokens: 8000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "{}";
  const json = text.replace(/^```json\n?/m, "").replace(/\n?```$/m, "").trim();

  let parsed: { questions: { number: number; answer: string }[]; overall_verdict: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("DeepSeek returned invalid JSON");
  }

  const answerMap = new Map(parsed.questions.map(q => [q.number, q.answer]));

  return {
    symbol,
    exchange,
    company_name: companyName,
    questions: QUESTIONS.map(q => ({
      ...q,
      answer: answerMap.get(q.number) ?? "Analysis not available for this question.",
    })),
    overall_verdict: parsed.overall_verdict ?? "",
    created_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 12-SIGNAL SCORING (DeepSeek — default for production analysis)
// These mirror lib/claude.ts but use DeepSeek's OpenAI-compatible endpoint.
// ═══════════════════════════════════════════════════════════════════════════

import { SIGNALS, getBand, MAX_SCORE, BUSINESS_MODELS, type BusinessModel } from "./signals";

export interface SignalResult {
  signal_id: string;
  label: string;
  score: number;
  max_score: number;
  reasoning: string;
  sources: string[];
}

// Same 3 parallel groups as the Claude version
export const SIGNAL_GROUPS = [
  ["S3", "S4", "S10"],              // A — Primary (MOAT, OPM, Exponential)
  ["S1", "S2", "S9", "S12"],        // B — Financial/market visibility
  ["S5", "S6", "S7", "S8", "S11"], // C — Qualitative
] as const;

async function deepseekChat(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4000
): Promise<string> {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return j.choices[0].message.content;
}

function buildSignalsSystemPrompt(): string {
  const s2Analogues = BUSINESS_MODELS.map(
    m => `  • ${m.label}: ${m.s2Analogue}`
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

Before scoring, you MUST classify the company into exactly one of these business models. This classification determines HOW each signal should be evaluated:

${BUSINESS_MODELS.map(m => `  • ${m.label} (${m.id}): ${m.description} Examples: ${m.examples}`).join("\n")}

─── VERIFICATION METHODOLOGY ───

Your "reasoning" field for each signal MUST follow this structured format:
CHECKING: [specific data source you checked — screener.in, BSE filing, annual report, etc.]
FOUND: [specific number, fact, name, or "data not found in expected location"]
ANALOGUE: [if you used a business-model-specific analogue, state which and why; otherwise write "standard metric applied"]
SCORE: [brief explanation of why the evidence maps to this specific score per the scoring rubric]

─── JSON OUTPUT ───

Return ONLY valid JSON — no markdown fences, no preamble, no trailing text.
The JSON must be a single object with "business_model" and "signals" fields.`;
}

/**
 * Scores a subset of signals for one company using DeepSeek.
 * Same interface as analyzeSignalGroup() in lib/claude.ts.
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
      id: s.id, label: s.label, max: s.max, primary: s.primary ?? false,
      question: s.question, what: s.what, note: s.note, scoring: s.scoring,
      sources_to_check: s.source, pass_example: s.pass, fail_example: s.fail,
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

  const text = await deepseekChat(buildSignalsSystemPrompt(), prompt, 4000);
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

/**
 * Generates a 3-5 sentence summary using DeepSeek.
 * Same interface as generateSummary() in lib/claude.ts.
 */
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

  const systemPrompt = `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks on NSE and BSE.
You apply the Microcap Multibagger Framework — a signal-based scoring system to find policy-driven, high-growth smallcaps.
Write clearly and concisely in plain prose. Do not use JSON, markdown, bullet points, or headers.`;

  return deepseekChat(systemPrompt, prompt, 400);
}
