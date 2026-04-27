export interface Signal {
  id: string;
  label: string;
  max: number;
  what: string;
  question: string;
  source: string;
  pass: string;
  fail: string;
  note: string;
  scoring: Record<number, string>;
}

export const SIGNALS: Signal[] = [
  {
    id: "S1", label: "Sector Tailwind", max: 3,
    what: "The sector is in a policy-driven, infrastructure-backed, or technology-led growth phase with multi-year momentum. Government capex, PLI schemes, or macro tailwinds must be clearly identifiable.",
    question: "Is there a clear policy or macro catalyst driving this sector for 5+ years?",
    source: "Budget allocations, PLI scheme documents, NITI Aayog strategy papers, Union Budget speech",
    pass: "Railway components (₹2.52L Cr capex), Metro EPC, Solar EPC, Defence indigenisation",
    fail: "Garment trading, traditional retail, commodity spot trading",
    note: "Auto-scores 3 if S10 (Exponential Market) also scores 3",
    scoring: { 3: "Strong policy + sector on S-curve with clear multi-year momentum", 2: "Partial policy support or sector in early tailwind phase", 1: "Indirect tailwind — adjacent to a hot sector", 0: "No visible policy or macro tailwind" }
  },
  {
    id: "S2", label: "Order Book > 2x Mcap", max: 3,
    what: "Confirmed, unexecuted project backlog vs current market cap. This is the single most powerful revenue-visibility signal. Only applies to EPC/project-based companies. Product manufacturers are scored on capacity utilisation instead.",
    question: "Is confirmed unexecuted backlog more than 2x market cap?",
    source: "BSE/NSE exchange filings, investor presentations, CWIP proxy, management guidance",
    pass: "Univastu India: ₹1,500 Cr OB vs ₹246 Cr Mcap = 6.1x",
    fail: "No real order book, or data confusion with unlisted group entity",
    note: "Exception allowed if S10+S11 ≥ 4 — nascent market company with no OB yet is acceptable",
    scoring: { 3: "Confirmed OB >2x Mcap", 2: "OB 1–2x Mcap, confirmed", 1: "OB <1x or capacity utilisation proxy used", 0: "No order book / product company with low utilisation" }
  },
  {
    id: "S3", label: "Product / Service Quality", max: 3,
    what: "Government or Tier-1 clients with repeat orders, hard-to-replicate product or process, internationally recognised certifications. The moat must be defensible against new entrants.",
    question: "Are clients Tier-1 or government? Is the moat hard to replicate?",
    source: "Company website client list, certifications page, annual report, RDSO/API/TPN approvals",
    pass: "Integra Engineering: Alstom + Siemens Mobility clients, EN 15085 CL-1 certification",
    fail: "Generic civil contractor with no differentiator, commodity trader",
    note: "Mass-life-impact products (S11) score higher here — the bigger the problem solved, the harder to replicate",
    scoring: { 3: "Tier-1/Govt clients + certified moat + repeat orders", 2: "Govt clients, some repeat, basic certification", 1: "One-off orders, no certification", 0: "Commodity / no differentiation" }
  },
  {
    id: "S4", label: "Strong Financials", max: 3,
    what: "ROCE, OPM, OCF, debt levels, PEG — combined financial health picture. Trend direction matters as much as absolute levels. A company improving from 12% to 18% ROCE is more interesting than one at a static 20%.",
    question: "ROCE >15%, OPM >5-10%, positive OCF, low debt, PEG <2?",
    source: "Screener.in quarterly results, annual report cash flow statement, Tijori Finance",
    pass: "Univastu India: ROCE 26.6%, OPM 14.6%, positive OCF, D/E 0.13",
    fail: "PAT went negative, or PAT declining 3 consecutive quarters",
    note: "OPM >5% acceptable if growth >50%. D/E <1.5 acceptable if debt is strategic for capacity expansion.",
    scoring: { 3: "All criteria met + improving trend", 2: "Most criteria met — 1 metric slightly below threshold", 1: "1–2 weak metrics but trajectory improving", 0: "PAT negative or D/E >1.5 with no strategic justification" }
  },
  {
    id: "S5", label: "Promoter Quality & Connections", max: 3,
    what: "Domain expertise in the exact business (not adjacent), strategic relationships that drive order flow, promoter holding >40% with zero pledging. Skin-in-the-game alignment is critical.",
    question: "Does the promoter have 10+ years exact domain? Holding >40%? Zero pledging?",
    source: "BSE shareholding pattern, LinkedIn profile, ASSOCHAM/CII council memberships, DRHP",
    pass: "Sanjay Patil (Markolines): 23 yrs microsurfacing, ASSOCHAM Roads Council, 56.9% holding",
    fail: "Promoter with <40% holding, any pledging, background in unrelated industry",
    note: "MNC parent or Swiss holding company scores 2/3 — governance is good but founder-operator alignment is higher",
    scoring: { 3: "Founder-operator, 10+ yrs exact domain, >40% holding, 0% pledging", 2: "MNC parent or strong domain but holding slightly <40%", 1: "Adjacent domain, holding 30–40%, no pledging", 0: "<30% holding or any pledging at all" }
  },
  {
    id: "S6", label: "Credit Rating", max: 2,
    what: "Third-party CRISIL, ICRA, or India Ratings validation of bank facilities. Signals institutional trust, access to working capital, and financial discipline. Upgrade trends matter more than the absolute rating level.",
    question: "Is there a CRISIL/ICRA/India Ratings rating on bank facilities?",
    source: "CRISIL/ICRA press releases, company BSE filings under Regulation 30",
    pass: "Univastu India: IVR BBB-/Stable (upgraded Jul 2025). Markolines: India Ratings rated.",
    fail: "No rating at all for a company with >3 years of significant bank borrowing",
    note: "Strong bank facility terms visible in annual report acceptable as a proxy if no formal rating exists",
    scoring: { 2: "Rated BBB- or above, or recently upgraded", 1: "Rated below BBB- or bank facility terms used as proxy", 0: "No rating despite significant borrowings" }
  },
  {
    id: "S7", label: "Employee Satisfaction", max: 2,
    what: "Great Place to Work certification, Glassdoor reviews >3.5, ISO 45001 occupational safety certification, low attrition signals. People quality = execution quality.",
    question: "GPTW certified? ISO 45001? Glassdoor >3.5?",
    source: "Great Place to Work India website, Glassdoor company page, LinkedIn employee reviews",
    pass: "Company with ISO 45001 + multiple Glassdoor reviews averaging 4.0+",
    fail: "High attrition in key technical/creative roles, anonymous management complaints",
    note: "ISO 45001 + Glassdoor >3.5 is an acceptable substitute for companies without a formal GPTW certification",
    scoring: { 2: "GPTW certified OR ISO 45001 + Glassdoor >3.5", 1: "Glassdoor 3.0–3.5, no major red flags", 0: "Glassdoor <3.0 or visible high-attrition complaints" }
  },
  {
    id: "S8", label: "Long-term Expansion Plan", max: 2,
    what: "Concrete, quantified management guidance with a credible roadmap — specific revenue targets, capacity expansion timelines, or geographic entry plans. Vague 'exploring opportunities' scores 0.",
    question: "Has management given specific revenue/capacity targets with timelines?",
    source: "Investor presentations (BSE filings), con-call transcripts, MD&A in annual report",
    pass: "Markolines: '100% revenue growth in 3 years' + specific order book targets",
    fail: "'We are exploring new opportunities in adjacent sectors' with no numbers",
    note: "Plans riding exponential market tailwinds (S10/S11) get higher credibility weight even if timelines are longer",
    scoring: { 2: "Specific numbers + timelines + credible execution track record", 1: "Some guidance but vague timelines or unverified targets", 0: "No guidance or purely vague statements" }
  },
  {
    id: "S9", label: "Undervalued vs Growth (PEG)", max: 3,
    what: "Low P/E relative to earnings growth rate. PEG = P/E ÷ EPS growth rate. PEG <1 = undervalued vs growth, PEG <0.5 = very attractive. Always cross-check with forward P/E, not just trailing.",
    question: "Is P/E <30x? Is PEG <1.5? Is forward P/E lower than trailing?",
    source: "Screener.in, Tickertape — check forward P/E vs analyst estimates, not trailing",
    pass: "Univastu India: P/E ~15x on accelerating earnings. PPSL: P/E 6.1x vs sector 86x.",
    fail: "P/E 126x on flat/declining growth. P/E 414x on ₹19 Cr revenue.",
    note: "P/E <30x acceptable if growth >50%. PEG is the primary metric — not standalone P/E.",
    scoring: { 3: "PEG <1.0, P/E <20x on strong growth", 2: "PEG 1.0–1.5, P/E <30x", 1: "PEG 1.5–2.0 or P/E 30–50x", 0: "PEG >2 or P/E >50x on flat/declining growth" }
  },
  {
    id: "S10", label: "Exponential Market", max: 3,
    what: "The market this company operates in doesn't fully exist yet at scale — but will be 100x bigger in 10 years. Think green hydrogen, waste-to-energy, smart traffic management, EV charging, space tech, water treatment. Genuinely nascent, at the start of an S-curve.",
    question: "Will this market be 100x bigger in 10 years? Is there a government programme?",
    source: "NITI Aayog strategy documents, Budget speech, PM mission announcements, SECI programme announcements",
    pass: "Green hydrogen company: SECI SIGHT programme, India's 5 MMT green H2 target by 2030",
    fail: "Refrigerant blending — mature commodity cycle, not exponential",
    note: "If S10 = 3, then S1 auto-scores 3. True inflection requires: govt programme + proven technology + early commercial revenues.",
    scoring: { 3: "Govt programme + proven technology + early commercial revenues", 2: "Clear govt intent but still pre-commercial", 1: "Adjacent to an exponential market", 0: "Mature, commoditised market" }
  },
  {
    id: "S11", label: "Mass Life Impact", max: 3,
    what: "The company solves a problem that touches every Indian's daily life — waste, water, traffic, air quality, food safety, healthcare access. Demand is recurring and month-on-month compounding. Not niche B2B.",
    question: "Does the product touch >10 crore Indians daily? Is demand recurring?",
    source: "SECC census data, urban population density reports, MOSPI consumption surveys, TAM analysis",
    pass: "Waste management: every household generates ~1 kg/day — infinite recurring demand. Traffic tech: 30 Cr+ vehicles.",
    fail: "Sells railway enclosures to OEMs — B2B niche, not mass daily-life impact",
    note: "The test: does an average Indian encounter this problem every single day? If yes, demand is structurally infinite.",
    scoring: { 3: "Every Indian affected daily — waste/water/traffic/food", 2: "Large segment affected — healthcare/education/housing", 1: "Millions affected but not universal", 0: "B2B niche with no direct consumer touchpoint" }
  },
  {
    id: "S12", label: "Revenue Quality / Predictability", max: 3,
    what: "How predictable and recurring is the revenue? Investors heavily discount businesses where growth is real but cash collection is uncertain. A subscription-revenue company trades at a premium P/E to a lumpy EPC company at the same growth rate.",
    question: "Is revenue recurring/subscription (3), framework contracts (2), project EPC (1), or spot (0)?",
    source: "Annual report 'nature of business' section, con-call transcripts, revenue segment disclosures, debtor days trend",
    pass: "Long-term highway O&M maintenance contracts — 3–5 year recurring, predictable billing",
    fail: "Construction EPC — milestone billing, slow government payments, high payment risk",
    note: "Debtor days trend is a proxy: rising debtor days = deteriorating revenue quality even if topline looks good.",
    scoring: { 3: "Recurring/subscription/SaaS-like revenue", 2: "Multi-year framework contracts with blue-chip clients", 1: "Project-based with PSU/govt clients — payment risk exists", 0: "Spot tender / trading / one-off contracts" }
  }
];

export const BANDS = [
  { min: 26, label: "STRONG BUY",  color: "#22c55e", bg: "#022c11", desc: "Research deeply, build position. Very rare — verify order book independently." },
  { min: 18, label: "WATCHLIST",   color: "#f59e0b", bg: "#1c1005", desc: "Set a specific entry trigger. Wait for a catalytic event before buying." },
  { min: 12, label: "INVESTIGATE", color: "#f97316", bg: "#1c0e05", desc: "Check blockers — can they resolve? Annual report + quarterly results needed." },
  { min: 0,  label: "AVOID",       color: "#ef4444", bg: "#1f0505", desc: "Do not invest. Eliminate from list entirely." },
] as const;

export function getBand(score: number) {
  return [...BANDS].reverse().find(b => score >= b.min) ?? BANDS[3];
}

export const MAX_SCORE = SIGNALS.reduce((a, s) => a + s.max, 0); // 36
