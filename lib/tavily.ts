interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
}

async function search(query: string, maxResults = 3): Promise<TavilyResult[]> {
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
    const data = await res.json() as { results?: TavilyResult[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

function formatResults(label: string, results: TavilyResult[]): string {
  if (!results.length) return "";
  return `\n─── ${label} ───\n` +
    results.map(r => `[${r.title}] ${r.url}\n${r.content}`).join("\n\n");
}

/**
 * Fetches live web data for signals that Screener.in doesn't cover:
 * S2 (Order Book), S6 (Credit Rating), S7 (Employee Satisfaction), S1/S9 (Sector news).
 * Results are injected into the AI context alongside Screener data.
 */
export async function fetchTavilyContext(companyName: string): Promise<string> {
  const [orderBook, creditRating, employees, news] = await Promise.all([
    search(`${companyName} order book backlog pipeline crores 2024 2025`, 3),
    search(`${companyName} CRISIL ICRA CARE credit rating 2024 2025`, 2),
    search(`${companyName} Glassdoor employee review India`, 2),
    search(`${companyName} government contract award news 2025`, 2),
  ]);

  const sections = [
    formatResults("ORDER BOOK / PIPELINE — for S2 scoring", orderBook),
    formatResults("CREDIT RATING — for S6 scoring", creditRating),
    formatResults("EMPLOYEE REVIEWS — for S7 scoring", employees),
    formatResults("RECENT NEWS & CONTRACTS — for S1/S9 scoring", news),
  ].filter(Boolean);

  if (!sections.length) return "";
  return "\n\n═══ LIVE WEB RESEARCH (via Tavily) ═══" + sections.join("\n") + "\n═══════════════════════════════════════\n";
}
