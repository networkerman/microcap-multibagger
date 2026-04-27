import Anthropic from "@anthropic-ai/sdk";
import { SIGNALS, getBand, MAX_SCORE } from "./signals";

// Three parallel groups. Group A (primary signals) runs first conceptually,
// but all three are fired simultaneously. Each resolves independently and
// is persisted to the DB as soon as it completes, giving the UI progressive data.
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
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const SYSTEM = `You are an expert Indian stock market analyst specialising in microcap and smallcap stocks on NSE and BSE.
You apply the Microcap Multibagger Framework — a signal-based scoring system to find policy-driven, high-growth smallcaps.

Sources to check: screener.in, bseindia.com, nseindia.com, CRISIL/ICRA press releases, Glassdoor, LinkedIn, NITI Aayog documents, Budget speeches.

RULES:
1. If S10 scores ≥3, S1 must also score 3.
2. Score conservatively. When in doubt, score lower.
3. Never fabricate data. If unverifiable, say so and score accordingly.
4. Cite a specific source for every signal score.
5. Return ONLY valid JSON — no markdown, no preamble, no trailing text.`;

// Scores a subset of signals for one company. Called in parallel for each group.
export async function analyzeSignalGroup(
  symbol: string,
  exchange: string,
  companyName: string,
  signalIds: readonly string[]
): Promise<SignalResult[]> {
  const signals = SIGNALS.filter(s => signalIds.includes(s.id)).map(s => ({
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

  const prompt = `Analyse: ${companyName} (${symbol}, ${exchange})

Score ONLY the following ${signals.length} signal(s). Return a JSON array — nothing else:
[
  {
    "signal_id": "S3",
    "label": "MOAT & Entry Barriers",
    "score": <integer 0 to max>,
    "max_score": 5,
    "reasoning": "<2-4 sentences with specific verifiable data and sources>",
    "sources": ["<source name or URL>"]
  }
  ...
]

Signals to score:
${JSON.stringify(signals, null, 2)}`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "[]";
  const json = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
  return JSON.parse(json) as SignalResult[];
}

// Generates a 3-5 sentence summary once all signals are scored.
export async function generateSummary(
  symbol: string,
  exchange: string,
  companyName: string,
  signals: SignalResult[],
  band: string,
  total: number,
  max: number
): Promise<string> {
  const prompt = `${companyName} (${symbol}, ${exchange}) scored ${total}/${max} — ${band}.

Signal scores:
${signals.map(s => `${s.signal_id} ${s.label}: ${s.score}/${s.max_score} — ${s.reasoning}`).join("\n")}

Write a 3-5 sentence investment thesis summary: strongest signals, biggest risks, and overall conviction. Be specific and direct. Return plain text only.`;

  const message = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].type === "text" ? message.content[0].text.trim() : "";
}
