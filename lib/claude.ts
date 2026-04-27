import Anthropic from "@anthropic-ai/sdk";
import { SIGNALS, getBand, MAX_SCORE, type Signal } from "./signals";

const client = new Anthropic();

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
}

function buildSystemPrompt(): string {
  return `You are an expert Indian stock market analyst specializing in microcap and smallcap stocks listed on NSE and BSE.
You apply the Microcap Multibagger Framework — a 12-signal scoring system designed to identify high-conviction, policy-driven, high-growth smallcaps.

Your task: Given a stock name and symbol, research it thoroughly and score each of the 12 signals. Be honest, rigorous, and conservative.
A score of 3 should be genuinely rare. Base scores only on publicly verifiable data.

Key sources you must check:
- BSE/NSE exchange filings (screener.in, bseindia.com, nseindia.com)
- Company annual reports and investor presentations
- Screener.in for financial ratios (ROCE, OPM, D/E, promoter holding, pledging)
- CRISIL/ICRA/India Ratings press releases for credit ratings
- Glassdoor and LinkedIn for employee signals
- NITI Aayog, PLI scheme documents for sector tailwinds

CRITICAL RULES:
1. If S10 (Exponential Market) scores 3, S1 (Sector Tailwind) must also score 3.
2. Score conservatively — when in doubt, score lower.
3. Never fabricate financial data. If you cannot verify a metric, state that and score accordingly.
4. For each signal, cite the specific source where you found the data.

Return ONLY valid JSON matching the exact schema provided. No markdown, no preamble.`;
}

function buildUserPrompt(symbol: string, exchange: string, companyName: string): string {
  const signalDefs = SIGNALS.map(s => ({
    id: s.id,
    label: s.label,
    max: s.max,
    question: s.question,
    what: s.what,
    note: s.note,
    scoring: s.scoring,
    sources_to_check: s.source,
    pass_example: s.pass,
    fail_example: s.fail,
  }));

  return `Analyse this Indian listed company using the Microcap Multibagger Framework:

Company: ${companyName}
Symbol: ${symbol}
Exchange: ${exchange}

Score each of the 12 signals below. Return a JSON object with this exact structure:
{
  "signals": [
    {
      "signal_id": "S1",
      "label": "Sector Tailwind",
      "score": <integer 0 to max>,
      "max_score": 3,
      "reasoning": "<2-4 sentences citing specific data points and sources>",
      "sources": ["<specific URL or document name>"]
    },
    ... (all 12 signals)
  ],
  "summary": "<3-5 sentence investment thesis summary covering the strongest signals, biggest risks, and overall conviction level>"
}

Signal definitions:
${JSON.stringify(signalDefs, null, 2)}

Important: Apply the S10→S1 auto-score rule if applicable.`;
}

export async function analyzeStock(
  symbol: string,
  exchange: string,
  companyName: string
): Promise<AnalysisResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    system: buildSystemPrompt(),
    messages: [
      { role: "user", content: buildUserPrompt(symbol, exchange, companyName) }
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Strip any accidental markdown fences
  const json = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(json);

  const signals: SignalResult[] = parsed.signals;
  const total_score = signals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total_score);

  return {
    signals,
    total_score,
    max_score: MAX_SCORE,
    band: band.label,
    summary: parsed.summary,
  };
}
