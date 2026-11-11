// Fetches and parses financial data from Screener.in for a given stock.
// This is the data-grounding layer — the model scores signals based on
// actual numbers, not training-data guesses (which are unreliable for
// SME-listed, recently-IPO'd, or low-profile stocks).
//
// Every figure is read from a specific table or element on the page. Do not
// add "first match anywhere in the HTML" regexes: the pros/cons bullets and
// document links contain look-alike text (a bullet saying "Promoter holding
// has decreased over last quarter: -0.44%" was once read as a 0.44% holding).

import { decodeHtmlEntities } from "@/lib/html-entities";

export interface ScreenerData {
  companyName: string;
  screenerUrl: string;
  // Key ratios
  marketCapCr: string;
  currentPrice: string;
  stockPE: string;
  bookValue: string;
  roce: string;
  roe: string;
  dividendYield: string;
  yearHighLow: string;
  // Balance sheet
  debtToEquity: string;
  borrowings: string;
  // Shareholding
  promoterHolding: string;
  promoterPledging: string;
  // About / sector
  about: string;
  industry: string;
  // Annual trends (up to the last 5 periods, oldest → latest)
  annualRevenue: string;
  annualPAT: string;
  annualOPM: string;
  cashFromOperations: string;
  roceTrend: string;
  debtorDays: string;
  workingCapitalDays: string;
  // Quarterly trends (last 5 quarters)
  quarterlyRevenue: string;
  quarterlyPAT: string;
  // Credit rating documents listed on the page (agency and date; not the grade)
  creditRating: string;
}

const SCREENER_BASE = "https://www.screener.in";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/json",
};
const SERIES_SUFFIX = /-(BE|BZ|SM|ST|BL|IL|E1|X1)$/;
const NA = "N/A";

function clean(s: string): string {
  // Strip tags first, then decode entities, then collapse whitespace.
  // Order matters: decoding before stripping could expose injected tags.
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")).replace(/\s+/g, " ").trim();
}

// Resolves a stock symbol to its Screener.in company page URL.
// BSE SME stocks use numeric BSE codes (e.g. /company/544224/).
async function resolveScreenerUrl(symbol: string): Promise<string | null> {
  try {
    const search = async (q: string): Promise<Array<{ id: number; name: string; url: string }>> =>
      (await fetch(`${SCREENER_BASE}/api/company/search/?q=${encodeURIComponent(q)}`, { headers: HEADERS })).json();

    let results = await search(symbol);
    // Exchange series suffixes (AIMTRON-SM, KRN-BE) are not part of Screener's symbol.
    const base = symbol.replace(SERIES_SUFFIX, "");
    if (!results.length && base !== symbol) {
      symbol = base;
      results = await search(symbol);
    }
    if (!results.length) return null;

    // Prefer exact symbol match, fall back to first result
    const match = results.find(r =>
      r.url.toLowerCase().includes(symbol.toLowerCase()) ||
      r.name.toLowerCase().includes(symbol.toLowerCase())
    ) ?? results[0];

    return SCREENER_BASE + match.url;
  } catch {
    return null;
  }
}

// ─── Page parsing ────────────────────────────────────────────────────────────

function section(html: string, id: string): string {
  return html.match(new RegExp(`id="${id}".*?</section>`, "s"))?.[0] ?? "";
}

function extractRatios(html: string): Record<string, string> {
  const ratios: Record<string, string> = {};
  const block = html.match(/id="top-ratios"(.*?)<\/ul>/s)?.[1] ?? "";
  for (const [, li] of block.matchAll(/<li[^>]*>(.*?)<\/li>/gs)) {
    const name = li.match(/<span[^>]*class="name"[^>]*>(.*?)<\/span>/s)?.[1];
    // "High / Low" carries two numbers; keep them all.
    const numbers = [...li.matchAll(/<span[^>]*class="number"[^>]*>(.*?)<\/span>/gs)].map(([, n]) => clean(n));
    if (name && numbers.length) ratios[clean(name)] = numbers.join(" / ");
  }
  return ratios;
}

interface Table { periods: string[]; rows: Map<string, string[]> }

// Normalises a row label: "Sales +" → "sales", "OPM %" → "opm".
const rowKey = (label: string) => label.replace(/[+%]\s*$/, "").trim().toLowerCase();

/** Parses the first data table inside a block of HTML into period headers and labelled rows. */
function parseTable(block: string): Table {
  const table = block.match(/<table.*?<\/table>/s)?.[0] ?? "";
  const periods = [...(table.match(/<thead.*?<\/thead>/s)?.[0] ?? "").matchAll(/<th[^>]*>(.*?)<\/th>/gs)]
    .map(([, c]) => clean(c)).filter(Boolean);
  const rows = new Map<string, string[]>();
  for (const [, tr] of table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    const cells = [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, c]) => clean(c));
    if (cells.length > 1) rows.set(rowKey(cells[0]), cells.slice(1));
  }
  return { periods, rows };
}

function findRow(t: Table, labels: string[]): string[] | undefined {
  for (const label of labels) {
    for (const [key, values] of t.rows) if (key.startsWith(label)) return values;
  }
  return undefined;
}

/** Last `n` values of a row, each tagged with its period: "Mar 2025 239 → Mar 2026 583 → TTM 640". */
function trend(t: Table, labels: string[], n = 5): string {
  const values = findRow(t, labels);
  if (!values) return NA;
  const periods = t.periods.slice(-values.length);
  const points = values.map((v, i) => (v ? `${periods[i] ?? ""} ${v}`.trim() : "")).filter(Boolean);
  return points.length ? points.slice(-n).join(" → ") : NA;
}

const toNumber = (s: string | undefined) => (s === undefined || s === "" ? NaN : parseFloat(s.replace(/,/g, "")));

function extractBalanceSheet(html: string): { debtToEquity: string; borrowings: string } {
  const t = parseTable(section(html, "balance-sheet"));
  const latest = (labels: string[]) => toNumber(findRow(t, labels)?.at(-1));
  const debt = latest(["borrowings", "borrowing"]);
  const netWorth = Math.round((latest(["equity capital"]) + latest(["reserves"])) * 100) / 100;
  return {
    borrowings: trend(t, ["borrowings", "borrowing"]),
    debtToEquity: isNaN(debt) || isNaN(netWorth) || netWorth <= 0
      ? "Not available"
      : `${(debt / netWorth).toFixed(2)} (borrowings ₹${debt} Cr / net worth ₹${netWorth} Cr, ${t.periods.at(-1) ?? "latest"})`,
  };
}

function extractPromoterHolding(html: string): { holding: string; pledging: string } {
  const shp = section(html, "shareholding");
  const t = parseTable(shp.match(/id="quarterly-shp".*?<\/table>/s)?.[0] ?? shp);
  const values = (findRow(t, ["promoters"]) ?? []).map(v => v.replace(/%$/, "")).filter(v => !isNaN(parseFloat(v)));
  const latest = values.at(-1);
  const holding = !latest
    ? (shp ? "No promoter group listed in the shareholding pattern (widely held)" : "Not disclosed")
    : values.length > 1 && values[0] !== latest
      ? `${latest}% (was ${values[0]}% ${values.length - 1} quarters earlier)`
      : `${latest}%`;

  // Screener states pledging as a "cons" bullet: "Promoters have pledged 27.5% of their holding".
  const pledge = html.match(/pledged\s+([\d.]+)\s*%/i)?.[1];
  return { holding, pledging: pledge ? `${pledge}% of promoter holding` : "None reported on Screener" };
}

function extractAbout(html: string): string {
  const m = html.match(/<div[^>]*class="[^"]*about[^"]*"[^>]*>.*?<p>(.*?)<\/p>/s)
    ?? html.match(/About.*?<p>(.*?)<\/p>/s);
  return m ? clean(m[1]).slice(0, 600) : "Not available";
}

function extractIndustry(html: string): string {
  const pick = (title: string) => html.match(new RegExp(`title="${title}"[^>]*>(.*?)</a>`, "s"))?.[1];
  return [pick("Broad Industry"), pick("Industry")].filter(Boolean).map(s => clean(s!)).join(" › ") || "Not available";
}

function extractCreditRatings(html: string): string {
  const list = html.match(/<h3[^>]*>\s*Credit ratings\s*<\/h3>.*?<ul[^>]*>(.*?)<\/ul>/s)?.[1] ?? "";
  const items = [...list.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map(([, li]) => clean(li)).filter(Boolean).slice(0, 3);
  return items.length
    ? `${items.join("; ")} (Screener lists the rating documents, not the grade — take the grade from the web research)`
    : "No rating documents listed on Screener";
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchScreenerData(symbol: string, exchange: string): Promise<ScreenerData | null> {
  const t0 = Date.now();
  console.log(`[screener] Resolving URL for ${exchange}:${symbol}`);
  try {
    const url = await resolveScreenerUrl(symbol);
    if (!url) {
      console.warn(`[screener] No URL found for ${exchange}:${symbol} — not listed on Screener.in`);
      return null;
    }
    console.log(`[screener] Resolved to ${url} — fetching page`);

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.error(`[screener] HTTP ${res.status} fetching ${url}`);
      return null;
    }

    const html = await res.text();
    if (!html.includes("top-ratios")) {
      console.warn(`[screener] Login wall or 404 at ${url} — "top-ratios" not found in HTML`);
      return null;
    }

    const ratios = extractRatios(html);
    const { holding, pledging } = extractPromoterHolding(html);
    const { debtToEquity, borrowings } = extractBalanceSheet(html);
    const annual = parseTable(section(html, "profit-loss"));
    const quarterly = parseTable(section(html, "quarters"));
    const cashFlow = parseTable(section(html, "cash-flow"));
    const ratioTable = parseTable(section(html, "ratios"));
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1];
    const companyName = h1 ? clean(h1) : symbol;

    console.log(
      `[screener] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s | company="${companyName}" | ` +
      `marketCap=${ratios["Market Cap"] ?? NA} | PE=${ratios["Stock P/E"] ?? NA} | ` +
      `ROCE=${ratios["ROCE"] ?? NA} | promoter=${holding} | D/E=${debtToEquity}`
    );

    return {
      companyName,
      screenerUrl: url,
      marketCapCr: ratios["Market Cap"] ?? NA,
      currentPrice: ratios["Current Price"] ?? NA,
      stockPE: ratios["Stock P/E"] ?? NA,
      bookValue: ratios["Book Value"] ?? NA,
      roce: ratios["ROCE"] ?? NA,
      roe: ratios["ROE"] ?? NA,
      dividendYield: ratios["Dividend Yield"] ?? NA,
      yearHighLow: ratios["High / Low"] ?? NA,
      debtToEquity,
      borrowings,
      promoterHolding: holding,
      promoterPledging: pledging,
      about: extractAbout(html),
      industry: extractIndustry(html),
      // Banks and NBFCs report "Revenue" and "Financing Profit" instead of "Sales" and "OPM".
      annualRevenue: trend(annual, ["sales", "revenue"]),
      annualPAT: trend(annual, ["net profit"]),
      annualOPM: trend(annual, ["opm", "financing margin"]),
      cashFromOperations: trend(cashFlow, ["cash from operating"]),
      roceTrend: trend(ratioTable, ["roce", "roe"]),
      debtorDays: trend(ratioTable, ["debtor days"]),
      workingCapitalDays: trend(ratioTable, ["working capital days"]),
      quarterlyRevenue: trend(quarterly, ["sales", "revenue"]),
      quarterlyPAT: trend(quarterly, ["net profit"]),
      creditRating: extractCreditRatings(html),
    };
  } catch (err) {
    console.error(`[screener] Exception for ${exchange}:${symbol}:`, err);
    return null;
  }
}

// Formats Screener data as a structured context block to prepend to the model prompt.
export function formatScreenerContext(data: ScreenerData): string {
  return `
=== VERIFIED FINANCIAL DATA FROM SCREENER.IN ===
Source: ${data.screenerUrl}
Company: ${data.companyName}
About: ${data.about}
Industry: ${data.industry}

KEY RATIOS (current):
- Market Cap: ₹${data.marketCapCr} Cr
- Current Price: ₹${data.currentPrice}
- Stock P/E: ${data.stockPE}x
- Book Value: ₹${data.bookValue}
- ROCE: ${data.roce}%
- ROE: ${data.roe}%
- Dividend Yield: ${data.dividendYield}%
- 52W High / Low: ₹${data.yearHighLow}
- Debt/Equity: ${data.debtToEquity}
- Promoter Holding: ${data.promoterHolding}
- Promoter Pledging: ${data.promoterPledging}
- Credit rating documents: ${data.creditRating}

ANNUAL TREND (₹ Cr unless stated, oldest → latest):
- Revenue: ${data.annualRevenue}
- Net Profit (PAT): ${data.annualPAT}
- Operating margin (financing margin for lenders): ${data.annualOPM}
- Cash from operations: ${data.cashFromOperations}
- Borrowings: ${data.borrowings}
- ROCE (ROE for lenders): ${data.roceTrend}
- Debtor days: ${data.debtorDays}
- Working capital days: ${data.workingCapitalDays}

QUARTERLY TREND (₹ Cr, oldest → latest):
- Revenue: ${data.quarterlyRevenue}
- Net Profit: ${data.quarterlyPAT}

IMPORTANT: Use the above verified data as the primary basis for scoring financial signals.
Do not contradict these numbers. "N/A" means the figure is not on Screener, not that it is zero.
=== END VERIFIED DATA ===
`.trim();
}
