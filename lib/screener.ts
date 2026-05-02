// Fetches and parses financial data from Screener.in for a given stock.
// This is the data-grounding layer — Claude scores signals based on
// actual numbers, not training-data guesses (which are unreliable for
// SME-listed, recently-IPO'd, or low-profile stocks).

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
  // From balance sheet / computed
  debtToEquity: string;
  promoterHolding: string;
  promoterPledging: string;
  // About / sector
  about: string;
  industry: string;
  // Annual P&L (last 4 years)
  annualRevenue: string;
  annualPAT: string;
  annualOPM: string;
  // Quarterly data (last 4 quarters)
  quarterlyRevenue: string;
  quarterlyPAT: string;
  // Credit rating
  creditRating: string;
  // Raw high/low
  yearHighLow: string;
}

const SCREENER_BASE = "https://www.screener.in";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/json",
};

function clean(s: string): string {
  // Strip tags first, then decode entities, then collapse whitespace.
  // Order matters: decoding before stripping could expose injected tags.
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

// Resolves a stock symbol to its Screener.in company page URL.
// BSE SME stocks use numeric BSE codes (e.g. /company/544224/).
async function resolveScreenerUrl(symbol: string, exchange: string): Promise<string | null> {
  try {
    const res = await fetch(`${SCREENER_BASE}/api/company/search/?q=${encodeURIComponent(symbol)}`, { headers: HEADERS });
    const results: Array<{ id: number; name: string; url: string }> = await res.json();
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

function extractRatios(html: string): Record<string, string> {
  const ratios: Record<string, string> = {};
  const block = html.match(/id="top-ratios"(.*?)<\/ul>/s)?.[1] ?? "";
  const pairs = [...block.matchAll(/<span[^>]*class="name"[^>]*>(.*?)<\/span>.*?<span[^>]*class="number"[^>]*>(.*?)<\/span>/gs)];
  for (const [, name, val] of pairs) {
    ratios[clean(name)] = clean(val);
  }
  return ratios;
}

function extractTableSection(html: string, sectionId: string, rowLabel: string): string {
  const section = html.match(new RegExp(`id="${sectionId}".*?<\/section>`, "s"))?.[0] ?? "";
  if (!section) return "Data not available";

  // Find the row matching rowLabel
  const rows = [...section.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)];
  for (const [, row] of rows) {
    if (row.includes(rowLabel)) {
      const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, c]) => clean(c));
      return cells.join(" | ");
    }
  }
  return "Not found";
}

function extractPromoterHolding(html: string): { holding: string; pledging: string } {
  // Look in shareholding section
  const holdingMatch = html.match(/Promoter[^%\d]*?([\d\.]+)\s*%/);
  const pledgeMatch = html.match(/Pledged[^%\d]*?([\d\.]+)\s*%/i);
  return {
    holding: holdingMatch?.[1] ? holdingMatch[1] + "%" : "Not disclosed",
    pledging: pledgeMatch?.[1] ? pledgeMatch[1] + "%" : "0% (not pledged)",
  };
}

function extractAbout(html: string): string {
  const m = html.match(/<div[^>]*class="[^"]*about[^"]*"[^>]*>.*?<p>(.*?)<\/p>/s)
    ?? html.match(/About.*?<p>(.*?)<\/p>/s);
  return m ? clean(m[1]).slice(0, 600) : "Not available";
}

function extractAnnualData(html: string): { revenue: string; pat: string; opm: string } {
  const section = html.match(/id="profit-loss".*?<\/section>/s)?.[0] ?? "";
  if (!section) return { revenue: "N/A", pat: "N/A", opm: "N/A" };

  const getRow = (label: string) => {
    const rows = [...section.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)];
    for (const [, row] of rows) {
      if (row.toLowerCase().includes(label.toLowerCase())) {
        const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, c]) => clean(c));
        // Return last 4 values (most recent years)
        return cells.slice(-5).join(" → ");
      }
    }
    return "N/A";
  };

  return {
    revenue: getRow("Sales") || getRow("Revenue"),
    pat: getRow("Net Profit") || getRow("PAT"),
    opm: getRow("OPM"),
  };
}

function extractQuarterlyData(html: string): { revenue: string; pat: string } {
  const section = html.match(/id="quarters".*?<\/section>/s)?.[0] ?? "";
  if (!section) return { revenue: "N/A", pat: "N/A" };

  const getRow = (label: string) => {
    const rows = [...section.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)];
    for (const [, row] of rows) {
      if (row.toLowerCase().includes(label.toLowerCase())) {
        const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(([, c]) => clean(c));
        return cells.slice(-5).join(" → ");
      }
    }
    return "N/A";
  };

  return {
    revenue: getRow("Sales") || getRow("Revenue"),
    pat: getRow("Net Profit") || getRow("PAT"),
  };
}

function extractDebtEquity(html: string): string {
  // Look for D/E in balance sheet or key ratios
  const m = html.match(/Debt\s*\/?\s*Equity[^<\d]*([\d\.]+)/i)
    ?? html.match(/D\/E[^<\d]*([\d\.]+)/i);
  return m?.[1] ?? "Not explicitly stated";
}

function extractCreditRating(html: string): string {
  const m = html.match(/(?:CRISIL|ICRA|CARE|India Ratings|Acuite|Brickwork)[^<]{0,80}(?:AAA|AA\+?|A\+?|BBB\+?-?|BB\+?-?|B\+?-?)/i);
  return m?.[0] ? clean(m[0]) : "No credit rating found in public filings";
}

export async function fetchScreenerData(symbol: string, exchange: string): Promise<ScreenerData | null> {
  try {
    const url = await resolveScreenerUrl(symbol, exchange);
    if (!url) return null;

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html.includes("top-ratios")) return null; // login wall or 404

    const ratios = extractRatios(html);
    const { holding, pledging } = extractPromoterHolding(html);
    const annual = extractAnnualData(html);
    const quarterly = extractQuarterlyData(html);

    return {
      companyName: html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1] ? clean(html.match(/<h1[^>]*>(.*?)<\/h1>/s)![1]) : symbol,
      screenerUrl: url,
      marketCapCr: ratios["Market Cap"] ?? "N/A",
      currentPrice: ratios["Current Price"] ?? "N/A",
      stockPE: ratios["Stock P/E"] ?? "N/A",
      bookValue: ratios["Book Value"] ?? "N/A",
      roce: ratios["ROCE"] ?? "N/A",
      roe: ratios["ROE"] ?? "N/A",
      dividendYield: ratios["Dividend Yield"] ?? "N/A",
      debtToEquity: extractDebtEquity(html),
      promoterHolding: holding,
      promoterPledging: pledging,
      about: extractAbout(html),
      industry: ratios["Industry"] ?? clean(html.match(/class="[^"]*breadcrumb[^"]*"[^>]*>.*?<a[^>]*>([^<]+)<\/a>\s*<\/li>\s*$/s)?.[1] ?? ""),
      annualRevenue: annual.revenue,
      annualPAT: annual.pat,
      annualOPM: annual.opm,
      quarterlyRevenue: quarterly.revenue,
      quarterlyPAT: quarterly.pat,
      creditRating: extractCreditRating(html),
      yearHighLow: ratios["High / Low"] ?? "N/A",
    };
  } catch {
    return null;
  }
}

// Formats Screener data as a structured context block to prepend to the Claude prompt.
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
- Debt/Equity: ${data.debtToEquity}
- Promoter Holding: ${data.promoterHolding}
- Promoter Pledging: ${data.promoterPledging}
- 52W High/Low: ₹${data.yearHighLow}
- Credit Rating: ${data.creditRating}

ANNUAL P&L TREND (₹ Cr, oldest→latest):
- Revenue: ${data.annualRevenue}
- Net Profit (PAT): ${data.annualPAT}
- OPM %: ${data.annualOPM}

QUARTERLY TREND (₹ Cr, oldest→latest):
- Revenue: ${data.quarterlyRevenue}
- Net Profit: ${data.quarterlyPAT}

IMPORTANT: Use the above verified data as the primary basis for scoring financial signals.
Do not contradict these numbers. If a ratio above clearly meets a signal threshold, score accordingly.
=== END VERIFIED DATA ===
`.trim();
}
