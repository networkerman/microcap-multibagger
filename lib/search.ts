// ═══════════════════════════════════════════════════════════════════════════════
// Three-layer search pipeline
//
//   1. Serper  — Google search (gl=in) for India-specific snippets       [paid]
//   2. Jina    — Free URL→clean-text extraction (r.jina.ai)              [free]
//   3. Tavily  — Cross-reference / confirm key numbers from Serper       [paid]
//
// Two exported functions:
//   fetchSignalContext()      — pre-fetches for 12-signal scoring
//   fetchDeepAnalysisContext() — pre-fetches for 15-question deep analysis
// ═══════════════════════════════════════════════════════════════════════════════

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
}

// ─── Serper ──────────────────────────────────────────────────────────────────

async function serper(
  query: string,
  type: "search" | "news" = "search",
  num = 5
): Promise<SerperResult[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`https://google.serper.dev/${type}`, {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", hl: "en", num }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { organic?: SerperResult[]; news?: SerperResult[] };
    return (type === "news" ? data.news : data.organic) ?? [];
  } catch {
    return [];
  }
}

// ─── Jina (free URL extraction) ──────────────────────────────────────────────

async function jinaExtract(url: string, maxChars = 1500): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Timeout": "10" },
    });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, maxChars).replace(/\n{3,}/g, "\n\n");
  } catch {
    return "";
  }
}

// ─── Tavily (cross-reference / fact-check a specific number) ─────────────────

async function tavilySearch(query: string, maxResults = 3): Promise<SerperResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: maxResults,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ url: string; title: string; content: string }> };
    return (data.results ?? []).map(r => ({ title: r.title, link: r.url, snippet: r.content }));
  } catch {
    return [];
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(label: string, results: SerperResult[], extraText?: string): string {
  if (!results.length && !extraText) return "";
  const lines = results.map((r, i) => {
    const date = r.date ? ` [${r.date}]` : "";
    return `  ${i + 1}. ${r.title}${date}\n     ${r.snippet ?? ""}`;
  });
  return (
    `\n─── ${label} ───\n` +
    lines.join("\n\n") +
    (extraText ? `\n\n  [FULL TEXT EXTRACT]\n  ${extraText.replace(/\n/g, "\n  ")}` : "")
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT 1 — 12-signal scoring context
//
// Covers signals Screener.in misses:
//   S2  Order Book / Pipeline
//   S6  Credit Rating (CRISIL / ICRA / CARE)
//   S7  Employee Satisfaction (Glassdoor / AmbitionBox)
//   S1  Sector Tailwind + S9 Exponential Opportunity (recent contracts/news)
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchSignalContext(companyName: string): Promise<string> {
  // Step 1 — Serper: 4 targeted searches in parallel
  const [orderBook, creditRating, employees, news] = await Promise.all([
    serper(`${companyName} order book backlog pipeline crores 2025`, "search", 4),
    serper(`${companyName} CRISIL ICRA CARE India Ratings credit rating 2025`, "search", 3),
    serper(`${companyName} Glassdoor AmbitionBox employee review rating`, "search", 3),
    serper(`${companyName} order contract award government 2025`, "news", 6),
  ]);

  // Step 2 — Jina: extract full text from top order book URL (free)
  const orderBookExtract = orderBook[0]?.link
    ? await jinaExtract(orderBook[0].link, 1200)
    : "";

  // Step 3 — Tavily: cross-reference the order book number from a second source
  const orderBookXRef = orderBook[0]?.snippet?.match(/[\d,]+\s*(?:crore|cr)/i)
    ? await tavilySearch(`${companyName} order book crores 2025`, 2)
    : [];

  const xRefNote = orderBookXRef.length
    ? `\n  [CROSS-REFERENCE via Tavily]\n` +
      orderBookXRef.map(r => `  • ${r.snippet?.slice(0, 200)}`).join("\n")
    : "";

  const sections = [
    fmt("ORDER BOOK / PIPELINE — S2 scoring", orderBook, orderBookExtract + xRefNote),
    fmt("CREDIT RATING (CRISIL/ICRA/CARE) — S6 scoring", creditRating),
    fmt("EMPLOYEE REVIEWS (Glassdoor/AmbitionBox) — S7 scoring", employees),
    fmt("RECENT CONTRACTS & NEWS — S1/S9 scoring", news),
  ].filter(Boolean);

  if (!sections.length) return "";
  return (
    "\n\n═══ LIVE WEB RESEARCH (Serper + Jina + Tavily) ═══" +
    sections.join("\n") +
    "\n\nPrioritise this data over training knowledge when it conflicts.\n" +
    "═══════════════════════════════════════════════════════\n"
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT 2 — 15-question deep analysis context
//
// Targets the questions that need live web data:
//   Q5   Risks — competition, regulatory, sector threats
//   Q6   Management integrity — SEBI, controversies, governance
//   Q7   Minority treatment — related party, pledging, tunneling
//   Q8   Capital allocation — acquisitions, bad investments
//   Q9   MD&A honesty — Jina extracts actual annual report text
//   Q10  Promoter skin — insider buying/selling news
//   Q11/12 Valuation — analyst targets, EV/EBITDA comps
// ═══════════════════════════════════════════════════════════════════════════════

export async function fetchDeepAnalysisContext(companyName: string): Promise<string> {
  // Step 1 — Serper: 5 targeted searches in parallel
  const [risks, governance, minority, capex, valuation, promoter] = await Promise.all([
    serper(`${companyName} risks competition regulatory threats sector 2025`, "search", 3),
    serper(`${companyName} management controversy SEBI action governance fraud 2025`, "search", 3),
    serper(`${companyName} related party transactions promoter pledging minority shareholders`, "search", 3),
    serper(`${companyName} acquisition investment capital allocation history`, "search", 3),
    serper(`${companyName} analyst target price EV EBITDA valuation peer comparison`, "search", 3),
    serper(`${companyName} promoter buying selling shares insider transactions 2025`, "news", 4),
  ]);

  // Step 2 — Jina: try to extract the MD&A section from the BSE annual report listing
  // (Search for the annual report PDF link first, then extract it)
  const annualReportSearch = await serper(`${companyName} annual report 2024 2025 BSE NSE PDF investor`, "search", 2);
  const annualReportUrl = annualReportSearch[0]?.link ?? "";
  const annualReportExtract = annualReportUrl
    ? await jinaExtract(annualReportUrl, 2000)
    : "";

  // Step 3 — Tavily: cross-reference any governance red flags
  const govXRef = governance.length
    ? await tavilySearch(`${companyName} management integrity governance track record`, 2)
    : [];

  const govNote = govXRef.length
    ? `\n  [CROSS-REFERENCE]\n` + govXRef.map(r => `  • ${r.snippet?.slice(0, 200)}`).join("\n")
    : "";

  const sections = [
    fmt("BUSINESS RISKS — Q5", risks),
    fmt("MANAGEMENT GOVERNANCE — Q6", governance, govNote),
    fmt("MINORITY SHAREHOLDER TREATMENT — Q7", minority),
    fmt("CAPITAL ALLOCATION HISTORY — Q8", capex),
    fmt("VALUATION & ANALYST VIEWS — Q11/Q12", valuation),
    fmt("PROMOTER ACTIVITY — Q10", promoter),
    annualReportExtract
      ? `\n─── ANNUAL REPORT EXTRACT (MD&A) — Q8/Q9 ───\n${annualReportExtract}`
      : "",
  ].filter(Boolean);

  if (!sections.length) return "";
  return (
    "\n\n═══ LIVE WEB RESEARCH FOR DEEP ANALYSIS ═══" +
    sections.join("\n") +
    "\n\nUse this live data to ground your answers. Cite sources where possible.\n" +
    "════════════════════════════════════════════\n"
  );
}
