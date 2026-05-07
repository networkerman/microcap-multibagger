// DeepSeek API client — OpenAI-compatible endpoint
// Used exclusively for the 15-question investor deep analysis (Vishal Khandelwal framework)

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
