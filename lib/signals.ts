// ─── Business Model Classification ───────────────────────────────────────────
// Before scoring ANY signal, Claude must classify the company into exactly one
// of these business models. The model determines which signals are mandatory and
// what analogue/metric to use for S2 (Order Book).

export type BusinessModel =
  | "epc"
  | "manufacturing"
  | "financial"
  | "infrastructure"
  | "services"
  | "trading"
  | "product";

export interface BusinessModelInfo {
  id: BusinessModel;
  label: string;
  description: string;
  examples: string;
  /** How S2 (Order Book) manifests for this business model */
  s2Analogue: string;
  /** Signals that are always mandatory for this model */
  mandatorySignals: string[];
}

export const BUSINESS_MODELS: BusinessModelInfo[] = [
  {
    id: "epc",
    label: "EPC / Project-Based",
    description: "Revenue comes from executing discrete projects — construction, engineering procurement, turnkey contracts. Backlog is the primary revenue-visibility metric.",
    examples: "Univastu India, Markolines, Integra Engineering, railway EPC contractors",
    s2Analogue: "Unexecuted project order book in ₹ Cr vs market cap. Check BSE/NSE exchange filings and investor presentations for confirmed, unexecuted backlog.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing / Production",
    description: "Revenue comes from producing and selling physical goods. Capacity utilisation and volume growth are the key operating metrics. Order book may exist as purchase orders from OEM customers.",
    examples: "Auto components, chemicals, industrial equipment, textile manufacturers",
    s2Analogue: "Capacity utilisation % × annual revenue capacity, or confirmed purchase orders from OEM/Tier-1 clients. Check annual report MD&A for utilisation % and investor presentations for order pipeline.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "financial",
    label: "Financial / NBFC / Fintech",
    description: "Revenue comes from lending, investing, or financial intermediation. Sanctioned loan pipeline, AUM, and undisbursed commitments are the 'order book' analogues.",
    examples: "IRFC, Bajaj Finance, PFC, REC, HUDCO, fintech lenders",
    s2Analogue: "Sanctioned but undisbursed loan pipeline OR committed AUM mandates vs market cap. Check annual report 'sanctions & disbursements' section, investor presentations, and borrowing programme filings.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "infrastructure",
    label: "Infrastructure / Asset Owner",
    description: "Revenue comes from operating and monetising long-lived assets — toll roads, transmission lines, renewable energy plants, ports. Contracted capacity and concession pipelines matter.",
    examples: "Highway toll operators, renewable energy IPPs, transmission companies, port operators",
    s2Analogue: "Contracted but not yet operational capacity (MW, km, etc.), or concession pipeline in ₹ Cr. Check investor presentations for capacity addition pipeline and PPA/concession agreement filings.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "services",
    label: "Services / IT / Consulting",
    description: "Revenue comes from human capital delivering services. Contracted but unbilled revenue and order book (signed SOWs/contracts) are the revenue-visibility metrics.",
    examples: "IT services, engineering consulting, facility management, BPO/KPO",
    s2Analogue: "Signed but not yet executed contracts OR contracted unbilled revenue vs market cap. Check investor presentations for deal wins, annual report 'contracts' section, and exchange filings for material contracts.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "product",
    label: "Product / SaaS / Subscription",
    description: "Revenue is recurring or subscription-based. ARR, committed subscription backlog, and renewal rates are the key revenue-visibility metrics.",
    examples: "B2B SaaS, subscription platforms, licensed product companies",
    s2Analogue: "Annual Recurring Revenue (ARR) backlog OR committed subscription value vs market cap. Check investor presentations for ARR/disclosed metrics, annual report revenue recognition policies, and customer concentration data.",
    mandatorySignals: ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
  {
    id: "trading",
    label: "Trading / Commodities / Distribution",
    description: "Revenue comes from buying and selling goods with no or minimal transformation. Margins are thin and volume-driven. No meaningful order backlog — revenue is spot/transactional.",
    examples: "Commodity spot traders, steel traders, generic chemical distributors, agricultural commodity traders",
    s2Analogue: "None — order book is genuinely not applicable. S2 should be scored 0 with explicit evidence that the business is pure spot trading. However, if the company has long-term supply contracts or framework agreements with customers, those ARE an order book analogue and S2 must be scored accordingly.",
    mandatorySignals: ["S1","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"],
  },
];

export function getBusinessModel(id: BusinessModel): BusinessModelInfo {
  return BUSINESS_MODELS.find(m => m.id === id)!;
}

// ─── Verification Step ──────────────────────────────────────────────────────

export interface VerificationStep {
  step: number;
  action: string;
  source: string;
  evidenceRequired: string;
}

// ─── Signal Applicability ───────────────────────────────────────────────────

export interface SignalApplicability {
  /** Business models where this signal MUST be scored — no skipping allowed */
  mandatory: BusinessModel[];
  /** Business models where the signal should be scored but is more qualitative */
  optional: BusinessModel[];
  /** Business models where the signal is genuinely N/A (very narrow) */
  notApplicable: BusinessModel[];
  /** How this signal manifests differently across business models */
  analogues?: Partial<Record<BusinessModel, string>>;
}

// ─── Signal Definition ──────────────────────────────────────────────────────

export interface Signal {
  id: string;
  label: string;
  max: number;
  primary?: boolean;
  what: string;
  question: string;
  source: string;
  pass: string;
  fail: string;
  note: string;
  scoring: Record<number, string>;

  // ─── NEW FIELDS ───────────────────────────────────────────────────────────
  /** Which business models this signal applies to */
  applicability: SignalApplicability;
  /** Ordered verification steps Claude must execute */
  verificationSteps: VerificationStep[];
  /** The ONLY condition under which this signal can be skipped/scored 0.
   *  Must be narrow and require evidence, not assumption. */
  notApplicableCondition: string;
}

export const SIGNALS: Signal[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // S1 — SECTOR TAILWIND (max 3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S1", label: "Sector Tailwind", max: 3,
    what: "The sector is in a policy-driven, infrastructure-backed, or technology-led growth phase with multi-year momentum. Government capex, PLI schemes, or macro tailwinds must be clearly identifiable.",
    question: "Is there a clear policy or macro catalyst driving this sector for 5+ years?",
    source: "Budget allocations, PLI scheme documents, NITI Aayog strategy papers, Union Budget speech",
    pass: "Railway components (₹2.52L Cr capex), Metro EPC, Solar EPC, Defence indigenisation",
    fail: "Garment trading, traditional retail, commodity spot trading",
    note: "Auto-scores 3 if S10 (Exponential Market) also scores 3. Look for specific budget line items and scheme names — not generic 'government is focusing on infrastructure'.",
    scoring: {
      3: "Strong policy + sector on S-curve with clear multi-year momentum",
      2: "Partial policy support or sector in early tailwind phase",
      1: "Indirect tailwind — adjacent to a hot sector",
      0: "No visible policy or macro tailwind"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {},
    },
    verificationSteps: [
      { step: 1, action: "Identify the company's primary sector/industry from its annual report or Screener.in industry field", source: "Screener.in, annual report", evidenceRequired: "Industry/sector name" },
      { step: 2, action: "Search Union Budget (latest) for capex allocations to this sector — find the specific ₹ Cr figure and scheme name", source: "Union Budget speech, Budget documents", evidenceRequired: "Specific budget line item with ₹ Cr figure" },
      { step: 3, action: "Check for active PLI schemes, NITI Aayog strategy documents, or PM mission mandates covering this sector", source: "NITI Aayog website, PLI scheme documents, PM mission announcements", evidenceRequired: "Scheme name and year of announcement" },
      { step: 4, action: "Verify whether the sector has multi-year (>5 year) visibility or is cyclical", source: "Sector reports, NITI Aayog 5-year plans", evidenceRequired: "Evidence of multi-year vs cyclical nature" },
      { step: 5, action: "Cross-check: if S10 scores ≥3, auto-score S1 as 3. Otherwise score based on policy evidence collected above", source: "S10 score from parallel analysis", evidenceRequired: "S10 score" },
    ],
    notApplicableCondition: "NEVER — every company operates in a sector. S1 must always be scored.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S2 — ORDER BOOK (max 3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S2", label: "Order Book > 2x Mcap", max: 3,
    what: "Confirmed, unexecuted revenue pipeline vs current market cap. This is the single most powerful revenue-visibility signal. HOWEVER — the form this takes depends on the business model. Every business except pure spot traders has an order-book analogue.",
    question: "What is the confirmed, unexecuted revenue pipeline relative to market cap (using the correct analogue for this business model)?",
    source: "BSE/NSE exchange filings, investor presentations, annual report MD&A, management guidance, loan sanction data (financials), PPA filings (infrastructure)",
    pass: "Univastu India: ₹1,500 Cr OB vs ₹246 Cr Mcap = 6.1x. IRFC: sanctioned undisbursed loan pipeline of ₹X Cr vs market cap of ₹Y Cr.",
    fail: "No verifiable pipeline at all, or pipeline data is conflated with an unlisted group entity",
    note: "CRITICAL: S2 has an analogue for EVERY business model except pure spot trading. Before even considering 'not applicable,' you MUST identify the company's business model and use the correct analogue. See BUSINESS_MODELS for the analogue per model. If S10+S11 ≥ 4, a nascent-market company with small/no pipeline is acceptable — score 1, not 0.",
    scoring: {
      3: "Confirmed pipeline >2x Mcap using correct business-model analogue",
      2: "Pipeline 1–2x Mcap, confirmed",
      1: "Pipeline <1x or nascent market where S10+S11 ≥ 4",
      0: "No pipeline at all AND company is a pure spot trader with no contracts (explicitly verified)"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","product"],
      optional: [],
      notApplicable: ["trading"],
      analogues: {
        epc: "Unexecuted project order book in ₹ Cr from exchange filings and investor presentations",
        manufacturing: "Capacity utilisation % × nameplate capacity revenue, or confirmed OEM purchase orders",
        financial: "Sanctioned but undisbursed loan pipeline / AUM commitments in ₹ Cr",
        infrastructure: "Contracted but not yet operational capacity (MW/km) or concession pipeline in ₹ Cr",
        services: "Signed but unbilled contracts / deal pipeline in ₹ Cr",
        product: "ARR or committed subscription backlog in ₹ Cr",
        trading: "N/A — but verify: if the trader has long-term supply contracts, those count as an order book"
      },
    },
    verificationSteps: [
      { step: 1, action: "FIRST: classify the business model (see BUSINESS_MODELS) and identify the correct S2 analogue", source: "Business model classification", evidenceRequired: "Business model + S2 analogue to use" },
      { step: 2, action: "Check BSE/NSE exchange filings for order book / contract award announcements (Reg 30 filings)", source: "BSE/NSE website — company announcements section", evidenceRequired: "Specific announcement with ₹ Cr figure or 'no announcements found'" },
      { step: 3, action: "Check the latest investor presentation for order book / pipeline / backlog data — these almost always contain this data if it exists", source: "Company website → Investors → Presentations, or BSE filings", evidenceRequired: "Slide/page with pipeline/backlog figure, or confirmation it's absent" },
      { step: 4, action: "Check annual report MD&A section for revenue visibility, order backlog, or forward guidance", source: "Annual report — Management Discussion & Analysis", evidenceRequired: "Specific statement about pipeline, or confirmation of absence" },
      { step: 5, action: "Calculate: confirmed pipeline in ₹ Cr ÷ market cap in ₹ Cr. If pipeline data genuinely does not exist anywhere, score based on business model — manufacturing uses capacity × revenue proxy; trading scores 0 with explicit verification of spot nature", source: "Screener.in for market cap", evidenceRequired: "Pipeline-to-Mcap ratio" },
    ],
    notApplicableCondition: "ONLY for pure spot commodity traders with ZERO long-term supply/offtake contracts. You must have explicitly verified the absence of any contracts before scoring 0. If unsure, score 1 and note the data gap.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S3 — MOAT & ENTRY BARRIERS (max 5, PRIMARY)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S3", label: "MOAT & Entry Barriers", max: 5, primary: true,
    what: "First, define the company's exact value proposition in one sentence — what specific problem does it solve and for whom? Then count how many credible competitors can match that exact value proposition today. Low competitor count = high entry barrier. Additional moat signals: Tier-1/Government clients with repeat orders, hard-to-replicate product or process, internationally recognised certifications, and high switching costs. If a well-funded new entrant entered tomorrow, how long would it take to match this company?",
    question: "What is the company's specific value proposition, and how many competitors can match it exactly? Are clients Tier-1 or government with repeat orders? Is the moat certified and hard to replicate?",
    source: "Company website client list, certifications page, annual report, RDSO/API/TPN approvals, competitive landscape from DRHP",
    pass: "Integra Engineering: Alstom + Siemens Mobility clients, EN 15085 CL-1 certification, 3–5 yr supplier approval cycles",
    fail: "Generic civil contractor with no differentiator, commodity trader, easily replicable service",
    note: "PRIMARY SIGNAL (max 5). Mass-life-impact products (S11) score higher here — the bigger the problem solved, the harder to replicate. Entry barriers include: regulatory approvals, certifications, long client approval cycles, proprietary process, network effects.",
    scoring: {
      5: "Monopoly/duopoly in niche + multi-yr certified supplier to Tier-1/Govt + zero realistic near-term competition",
      4: "Tier-1/Govt clients + hard moat (certified, regulatory, process) + high switching cost + few credible competitors",
      3: "Tier-1/Govt clients + certified moat + repeat orders",
      2: "Govt clients, some repeat, basic certification",
      1: "One-off orders, no certification",
      0: "Commodity / no differentiation / easily replicable"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "Franchise strength (branch network, customer base), underwriting moat, regulatory licence barrier, cost-of-funds advantage",
        services: "Client switching costs, proprietary methodology, long-term contracts, certification barrier",
        trading: "Exclusive distribution rights, long-term supply contracts, regional monopoly"
      },
    },
    verificationSteps: [
      { step: 1, action: "Define the company's value proposition in one sentence: what specific product/service does it offer, to which customer segment, and what is the key differentiator? Then search for direct competitors that match this exact value proposition — use Google ('[company sector] companies India', '[product type] manufacturers India'), and the DRHP/annual report Competition section. Count how many credible players can match this proposition today.", source: "Google search, DRHP / Annual report — Competition section, industry reports", evidenceRequired: "One-sentence value proposition + list of competitors matching it + count of credible competitors" },
      { step: 2, action: "Visit the company's official website and document the client list, certifications, and awards displayed", source: "Company website — Clients / About / Certifications pages", evidenceRequired: "List of named clients and certifications" },
      { step: 3, action: "Check the annual report for customer concentration (top 5/10 customers % of revenue) and client names in the 'Risk Factors' and 'Business Overview' sections", source: "Annual report", evidenceRequired: "Customer concentration % and named clients" },
      { step: 4, action: "Search for regulatory approvals or certifications: RDSO, API, TPN, ISO, AS9100, EN 15085, IATF 16949, or sector-specific equivalents. Verify they are CURRENT (not expired)", source: "Company website, BSE filings, regulatory body websites", evidenceRequired: "Certification name, issuing body, validity status" },
      { step: 5, action: "Read the DRHP (if recently listed) or annual report for the 'Competition' section — identify the number and scale of direct competitors. Cross-reference against the competitor list from Step 1.", source: "DRHP / Annual report — Competition section", evidenceRequired: "Number and names of direct competitors" },
      { step: 6, action: "Assess: how long would a well-funded new entrant take to replicate this company's position? Factor in: competitor count (Step 1), certifications (Step 4), client approval cycles (Step 2-3). <1 year = score 0-1, 1-3 years = score 2-3, 3+ years = score 4-5", source: "Synthesis of all above evidence", evidenceRequired: "Reasoned estimate with supporting evidence, citing competitor count and replication time" },
    ],
    notApplicableCondition: "NEVER — every company has some competitive position, even if it's weak. Score what exists.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S4 — OPM & FINANCIAL STRENGTH (max 5, PRIMARY)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S4", label: "OPM & Financial Strength", max: 5, primary: true,
    what: "Operating Profit Margin (OPM) is the primary lens — high and expanding OPM signals pricing power, moat, and operational leverage. Combine with ROCE, OCF, debt levels, and revenue growth trajectory. A company with OPM >15% growing at >40% YoY is extremely rare and should score maximum.",
    question: "OPM >10%? ROCE >15%? Revenue growing >30% YoY? Positive OCF? D/E <1.5?",
    source: "Screener.in quarterly results (OPM trend), annual report cash flow statement, Tijori Finance, BSE quarterly filings",
    pass: "Univastu India: ROCE 26.6%, OPM 14.6%, positive OCF, D/E 0.13, revenue 3x in 3 years",
    fail: "PAT went negative, OPM declining 3 consecutive quarters, or D/E >2 with no strategic justification",
    note: "PRIMARY SIGNAL (max 5). OPM trend is more important than absolute level. OPM >5% acceptable if revenue growth >50%. Watch for working capital deterioration even when PAT looks good. Financial/NBFC companies: use NIM + ROA instead of OPM; D/E norms are different (higher leverage is normal for financials).",
    scoring: {
      5: "OPM >15% + ROCE >25% + revenue growing >50% YoY + positive OCF + D/E <0.5, all improving",
      4: "OPM >10% + ROCE >20% + strong revenue growth >30% + positive OCF + low debt, improving trend",
      3: "All core criteria met + improving trend (ROCE >15%, OPM >8%)",
      2: "Most criteria met — 1 metric slightly below threshold",
      1: "1–2 weak metrics but trajectory improving",
      0: "PAT negative or OPM declining or D/E >1.5 with no strategic justification"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "NIM (Net Interest Margin) instead of OPM; ROA instead of ROCE; Capital Adequacy Ratio instead of D/E. GNPA/NNPA for asset quality.",
        infrastructure: "EBITDA margin (depreciation-heavy). Check project-level IRRs. Debt is structural — check DSCR, not just D/E.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Pull OPM% (or NIM% for financials) from Screener.in — note the quarterly trend over the last 4-6 quarters", source: "Screener.in → Profit & Loss → OPM% row (or quarterly results)", evidenceRequired: "OPM% values for last 4+ quarters" },
      { step: 2, action: "Pull ROCE% and ROE% from Screener.in key ratios. For financials, pull ROA%", source: "Screener.in → Key Ratios", evidenceRequired: "ROCE%, ROE%, ROA% if applicable" },
      { step: 3, action: "Pull Debt/Equity ratio. For financials, pull Capital Adequacy Ratio and GNPA%. For infrastructure, also check DSCR", source: "Screener.in, annual report balance sheet notes", evidenceRequired: "D/E ratio or sector-specific leverage metric" },
      { step: 4, action: "Check annual report cash flow statement — is Operating Cash Flow positive in the latest year AND the prior year?", source: "Annual report → Cash Flow Statement", evidenceRequired: "OCF figure for latest year and previous year" },
      { step: 5, action: "Pull annual revenue growth % over last 3 years. Note whether growth is accelerating or decelerating", source: "Screener.in → Profit & Loss → Sales row (annual)", evidenceRequired: "Revenue growth rate for each of last 3 years" },
      { step: 6, action: "Check working capital: debtor days and inventory days trend. Rising debtor days = red flag even if PAT looks good", source: "Screener.in → Efficiency Ratios, or annual report schedules", evidenceRequired: "Debtor days trend, inventory days trend" },
    ],
    notApplicableCondition: "NEVER — every company has financial statements. Even pre-revenue companies have balance sheets (score on cash position, burn rate, and capital adequacy).",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S5 — PROMOTER QUALITY & CONNECTIONS (max 3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S5", label: "Promoter Quality & Connections", max: 3,
    what: "Domain expertise in the exact business (not adjacent), strategic relationships that drive order flow, promoter holding >40% with zero pledging. Skin-in-the-game alignment is critical.",
    question: "Does the promoter have 10+ years exact domain? Holding >40%? Zero pledging?",
    source: "BSE shareholding pattern, LinkedIn profile, ASSOCHAM/CII council memberships, DRHP",
    pass: "Sanjay Patil (Markolines): 23 yrs microsurfacing, ASSOCHAM Roads Council, 56.9% holding",
    fail: "Promoter with <40% holding, any pledging, background in unrelated industry",
    note: "MNC parent or Swiss holding company scores 2/3 — governance is good but founder-operator alignment is higher. For PSUs, score the administrative ministry oversight quality and chairman track record.",
    scoring: {
      3: "Founder-operator, 10+ yrs exact domain, >40% holding, 0% pledging",
      2: "MNC parent or strong domain but holding slightly <40%",
      1: "Adjacent domain, holding 30–40%, no pledging",
      0: "<30% holding or any pledging at all"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "Same criteria apply. Additionally check: any RBI/SEBI action against promoter, board governance rating, independent director quality.",
        product: "Founder technical background matters more than connections. Check GitHub, research publications, patent filings.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Pull shareholding pattern from BSE — note promoter group holding % and pledged %", source: "BSE → Company → Shareholding Pattern → Latest quarter", evidenceRequired: "Promoter holding %, pledged %" },
      { step: 2, action: "Search the promoter's name on LinkedIn — verify years of experience in this EXACT industry (not adjacent)", source: "LinkedIn", evidenceRequired: "Years of domain experience, past companies/roles" },
      { step: 3, action: "Check for industry body memberships: ASSOCHAM, CII, FICCI council positions, or sector-specific associations", source: "Google search: '[promoter name] ASSOCHAM/CII/FICCI council'", evidenceRequired: "Council membership or absence" },
      { step: 4, action: "Read DRHP 'Promoter Background' section (if recently listed) or annual report 'Board of Directors' section for promoter background", source: "DRHP or Annual Report", evidenceRequired: "Promoter background summary from official filing" },
      { step: 5, action: "Check for any regulatory actions, SEBI orders, or wilful defaulter status against the promoter or promoter group companies", source: "SEBI orders, RBI wilful defaulter list, CIBIL", evidenceRequired: "Presence or absence of regulatory actions" },
    ],
    notApplicableCondition: "NEVER — every company has promoters/management. Even widely-held companies (no promoter) should be scored on management and board quality.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S6 — CREDIT RATING (max 2)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S6", label: "Credit Rating", max: 2,
    what: "Third-party CRISIL, ICRA, CARE, India Ratings, Acuite, or Brickwork validation of bank facilities. Signals institutional trust, access to working capital, and financial discipline. Upgrade trends matter more than the absolute rating level.",
    question: "Is there a CRISIL/ICRA/India Ratings/CARE rating on bank facilities?",
    source: "CRISIL/ICRA press releases, company BSE filings under Regulation 30, annual report 'bank facilities' note",
    pass: "Univastu India: IVR BBB-/Stable (upgraded Jul 2025). Markolines: India Ratings rated.",
    fail: "No rating at all for a company with >3 years of significant bank borrowing",
    note: "Strong bank facility terms visible in annual report acceptable as a proxy if no formal rating exists. A recently UPGRADED rating scores higher than a static one. For financial companies, the credit rating of the institution ITSELF is the relevant rating.",
    scoring: {
      2: "Rated BBB- or above, or recently upgraded",
      1: "Rated below BBB- or bank facility terms used as proxy",
      0: "No rating despite significant borrowings"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure"],
      optional: ["services","product","trading"],
      notApplicable: [],
      analogues: {
        financial: "Institution's own credit rating (not just bank facilities). Also check: CRAR, regulatory capital adequacy, and any RBI/PCA framework actions.",
        product: "If bootstrapped/no debt, absence of rating is NOT a negative — score 1 (neutral). If venture-funded, check institutional investor quality as proxy.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Search '[company name] CRISIL rating' AND '[company name] ICRA rating' AND '[company name] India Ratings' on Google", source: "Google, CRISIL.com, ICRA.in, IndiaRatings.co.in", evidenceRequired: "Rating press release or confirmation of absence" },
      { step: 2, action: "Check BSE/NSE company announcements filtered for 'rating' or 'credit' — these are mandatory Reg 30 disclosures", source: "BSE/NSE website → Company announcements", evidenceRequired: "Rating-related announcement or confirmation of absence" },
      { step: 3, action: "Check the annual report 'Notes to Accounts' section for disclosure of bank facilities and any credit ratings mentioned", source: "Annual report — Notes to Accounts, borrowings section", evidenceRequired: "Bank facility details, any rating mentioned" },
      { step: 4, action: "If no rating found: check whether the company has significant bank borrowings. If borrowings <10% of total assets, absence of rating is normal — score 1. If borrowings are significant with no rating, score 0.", source: "Annual report balance sheet", evidenceRequired: "Total borrowings vs total assets" },
    ],
    notApplicableCondition: "ONLY if the company has ZERO bank borrowings (debt-free) and is not a financial institution. Even then, score 1 (neutral), not 0.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S7 — EMPLOYEE SATISFACTION (max 2)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S7", label: "Employee Satisfaction", max: 2,
    what: "For microcaps and smallcaps, formal certifications (GPTW, ISO 45001) are rare and not expected. The PRIMARY evidence is LinkedIn headcount growth trend, AmbitionBox/Glassdoor review sentiment, and employee retention of key technical/managerial staff. People quality = execution quality — but measured appropriately for company size.",
    question: "Is the team growing? Are current employees staying 3+ years? Are online reviews broadly positive (>3.0 on AmbitionBox/Glassdoor)? Any labour disputes?",
    source: "LinkedIn company page (headcount trend, employee tenure), AmbitionBox (Indian SME reviews), Glassdoor, Great Place to Work India, EPFO compliance records, annual report employee cost section",
    pass: "Manufacturing SME: LinkedIn headcount grew 30% YoY, AmbitionBox 3.8★, key engineers staying 5+ years, no PF defaults",
    fail: "High attrition in technical roles, management complaints on AmbitionBox, EPFO default notice, or labour dispute history",
    note: "GPTW certification is a BONUS, not the primary path. For microcaps (<₹2,000 Cr mcap), LinkedIn headcount growth >20% YoY + AmbitionBox >3.0 is sufficient for score 2. The default score for 'no data found' is 1 — do NOT score 0 because you couldn't find Glassdoor reviews.",
    scoring: {
      2: "GPTW certified (bonus) OR LinkedIn headcount growing >20% YoY + AmbitionBox/Glassdoor >3.5 OR (for microcaps) LinkedIn growing >20% + AmbitionBox >3.0 with no red flags. Active hiring + positive employee sentiment.",
      1: "LinkedIn headcount stable or growing slowly + AmbitionBox/Glassdoor 3.0–3.5 range. No negative signals. OR data is limited but no red flags found. DEFAULT score when employer data is sparse.",
      0: "High-attrition complaints on AmbitionBox/Glassdoor, labour disputes, EPFO/PF default notices, or mass layoffs reported in news. Negative employee sentiment with specific evidence."
    },
    applicability: {
      mandatory: ["services","product"],
      optional: ["epc","manufacturing","financial","infrastructure","trading"],
      notApplicable: [],
      analogues: {
        epc: "Focus on site worker safety compliance and skilled labour retention. Check for any labour ministry disputes. LinkedIn hiring for project engineers is a strong positive.",
        financial: "Check annual report for employee attrition rate disclosure. LinkedIn headcount growth in branch/field roles signals expansion.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Check LinkedIn company page: note total employee count AND year-over-year headcount growth %. Is the company actively hiring? Growing headcount = business confidence", source: "LinkedIn company page → Employees tab", evidenceRequired: "Employee count, YoY growth %, hiring trends" },
      { step: 2, action: "Check AmbitionBox for the company — this has more Indian SME reviews than Glassdoor. Note rating, review count, and key themes (especially in last 12 months)", source: "ambitionbox.com", evidenceRequired: "AmbitionBox rating, review count, sentiment themes" },
      { step: 3, action: "Check Glassdoor as secondary source — rating, review count, and any patterns in recent reviews", source: "glassdoor.co.in", evidenceRequired: "Glassdoor rating, review count, key themes" },
      { step: 4, action: "Search for GPTW certification as a BONUS (not required). GPTW + strong LinkedIn = automatic score 2", source: "greatplacetowork.in, Google", evidenceRequired: "GPTW certification status (bonus only)" },
      { step: 5, action: "NEGATIVE SCREEN: Search '[company name] labour dispute' AND '[company name] EPFO default' AND '[company name] layoffs'. Any negative findings cap the score at 0 regardless of other evidence", source: "Google News, EPFO website, labour ministry records", evidenceRequired: "Presence or absence of negative labour events" },
      { step: 6, action: "Check LinkedIn for employee tenure — look at key technical/managerial staff. Are people staying 3+ years? This is the best retention signal for microcaps", source: "LinkedIn company page → People section", evidenceRequired: "Employee tenure patterns, especially in technical roles" },
    ],
    notApplicableCondition: "ONLY if the company has <10 employees AND no LinkedIn page AND no online reviews at all. In that case, score 1 (neutral). Never score 0 because of missing data.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S8 — LONG-TERM EXPANSION PLAN (max 2)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S8", label: "Long-term Expansion Plan", max: 2,
    what: "Concrete, quantified management guidance with a credible roadmap — specific revenue targets, capacity expansion timelines, or geographic entry plans. Vague 'exploring opportunities' scores 0.",
    question: "Has management given specific revenue/capacity targets with timelines?",
    source: "Investor presentations (BSE filings), con-call transcripts, MD&A in annual report",
    pass: "Markolines: '100% revenue growth in 3 years' + specific order book targets",
    fail: "'We are exploring new opportunities in adjacent sectors' with no numbers",
    note: "Plans riding exponential market tailwinds (S10/S11) get higher credibility weight even if timelines are longer. A company that has consistently met past guidance gets higher credibility for future plans.",
    scoring: {
      2: "Specific numbers + timelines + credible execution track record",
      1: "Some guidance but vague timelines or unverified targets",
      0: "No guidance or purely vague statements"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {},
    },
    verificationSteps: [
      { step: 1, action: "Read the latest investor presentation — look for slides with revenue targets, capacity expansion plans, geographic expansion, or growth roadmaps with specific numbers and years", source: "Company website → Investors → Presentations; BSE filings", evidenceRequired: "Specific target with number and timeline, or confirmation of absence" },
      { step: 2, action: "Read the Management Discussion & Analysis (MD&A) section of the latest annual report — specifically the 'Outlook' or 'Future Plans' subsection", source: "Annual report → MD&A", evidenceRequired: "Forward-looking statements with specifics or confirmation of vagueness" },
      { step: 3, action: "Search for earnings call / con-call transcripts — these often contain more candid forward guidance than written documents", source: "BSE filings, company website investor section", evidenceRequired: "Con-call transcript excerpts or confirmation of absence" },
      { step: 4, action: "Verify credibility: check whether management met their past 2-3 years' guidance. If they consistently missed past targets, discount current guidance by one level", source: "Compare past investor presentations with actual results on Screener.in", evidenceRequired: "Past guidance vs actual performance comparison" },
    ],
    notApplicableCondition: "NEVER — every company has management that either provides guidance or doesn't. Score what exists.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S9 — VALUATION & MICROCAP ADVANTAGE (max 5)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S9", label: "Valuation & Microcap Adv.", max: 5,
    what: "This is a MULTIBAGGER framework — the highest returns come from companies small enough to 10x. Market cap is the PRIMARY lens: companies under ₹2,000 Cr get a structural advantage; companies over ₹10,000 Cr are mathematically near-impossible multibaggers regardless of PEG. PEG = P/E ÷ EPS growth rate is the secondary lens within each market cap tier.",
    question: "Market cap under ₹2,000 Cr? PEG <1.5? Is this a microcap with room to multiply?",
    source: "Screener.in (market cap ₹ Cr, Stock P/E, EPS growth rate), Tickertape, BSE shareholding for market cap cross-verification",
    pass: "Univastu India: ₹246 Cr mcap, P/E 15x, EPS growing 30% → PEG 0.5 + microcap advantage. PPSL: ₹80 Cr mcap, P/E 6.1x vs sector 86x.",
    fail: "HDFC Bank: ₹10L Cr+ mcap — cannot 10x. P/E 126x on ₹19 Cr revenue with declining growth. Megacap with PEG 0.5 is still NOT a multibagger.",
    note: "MICROCAP MULTIBAGGER SIGNAL (max 5). Market cap tier matters MORE than PEG. A ₹100 Cr company with PEG 2.0 has more multibagger potential than a ₹1L Cr company with PEG 0.3. PEG <1.0 auto-scores 3 minimum IF market cap <₹5,000 Cr. For financial companies: use P/BV vs ROE. For loss-making: use P/S vs revenue growth. Companies over ₹10,000 Cr mcap can NEVER score above 2.",
    scoring: {
      5: "Mcap <₹500 Cr + PEG <1.0 + strong revenue growth >30%. True microcap with both valuation AND growth — maximum multibagger potential.",
      4: "Mcap ₹500–2,000 Cr + PEG <1.0 + strong growth, or mcap <₹500 Cr + PEG 1.0–1.5. Smallcap with clear growth-value mismatch.",
      3: "Mcap <₹5,000 Cr + PEG <1.0, or mcap <₹2,000 Cr + PEG 1.0–1.5. Reasonable valuation with growth AND small enough to multiply.",
      2: "Mcap ₹5,000–10,000 Cr + PEG <1.5, or mcap <₹2,000 Cr + PEG 1.5–2.0. Midcap with decent valuation, or microcap with stretched but growing-into-it valuation.",
      1: "Mcap >₹10,000 Cr regardless of PEG (too large to multibag), or mcap ₹5,000–10,000 Cr + PEG >1.5. Large caps and expensive midcaps.",
      0: "Mcap >₹10,000 Cr + PEG >2.0, or any market cap with P/E >50x AND declining/flat growth. Expensive megacap — no multibagger potential."
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "Use P/BV (Price to Book Value) + ROE. ROE > P/BV ratio = undervalued. Market cap tier rules apply identically.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Pull MARKET CAP in ₹ Cr from Screener.in. This is the MOST IMPORTANT metric for this signal. Classify into tier: <₹500 Cr / ₹500–2,000 Cr / ₹2,000–5,000 Cr / ₹5,000–10,000 Cr / >₹10,000 Cr", source: "Screener.in → Key Ratios → Market Cap", evidenceRequired: "Market cap in ₹ Cr, assigned tier" },
      { step: 2, action: "Pull current P/E ratio from Screener.in. Note whether trailing or forward", source: "Screener.in → Key Ratios → Stock P/E", evidenceRequired: "Current P/E value" },
      { step: 3, action: "Calculate EPS growth rate: pull EPS for last 3 years from Screener.in annual P&L, compute CAGR. If quarterly data available, check QoQ EPS trend", source: "Screener.in → Profit & Loss → EPS row (annual)", evidenceRequired: "EPS for each of last 3 years, computed CAGR %" },
      { step: 4, action: "Calculate PEG = P/E ÷ EPS growth rate %. P/E 15x, growth 30% → PEG 0.5. Then apply market cap tier: is this a small company with a low PEG?", source: "Computed from steps 1-3", evidenceRequired: "PEG ratio, market-cap-adjusted assessment" },
      { step: 5, action: "Compare with sector: check sector average P/E. A microcap at 20x P/E in a sector averaging 50x is under-priced", source: "Screener.in, Tickertape sector comparisons", evidenceRequired: "Company P/E vs sector average P/E" },
      { step: 6, action: "For financials: pull P/BV and ROE. ROE > P/BV = undervalued. Apply market cap tier to the P/BV assessment", source: "Screener.in → Key Ratios", evidenceRequired: "P/BV, ROE%, P/BV-to-ROE ratio" },
      { step: 7, action: "For loss-making: use P/S ratio vs revenue growth %. Apply market cap tier similarly. Small loss-making company growing 100% can still rate well", source: "Screener.in", evidenceRequired: "P/S ratio, revenue growth %" },
    ],
    notApplicableCondition: "NEVER — every listed company has a market cap and valuation. Score what exists. Megacaps get low scores by design.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S10 — EXPONENTIAL MARKET & SCALE (max 5, PRIMARY)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S10", label: "Exponential Market & Scale", max: 5, primary: true,
    what: "The market this company operates in is at the start of an S-curve — revenues are early but the addressable market will be orders of magnitude larger in 10 years. Exponential sales growth (not just high growth — genuinely compounding acceleration quarter on quarter) is the clearest signal. Government programmes, budget allocations, and PM mission mandates are the ignition.",
    question: "Is revenue growth accelerating QoQ (not just YoY)? Will this market be 100x bigger in 10 years? Is there a dedicated government programme with budget?",
    source: "NITI Aayog strategy documents, Budget speech, PM mission announcements, SECI programme announcements, company quarterly revenue trend (check acceleration)",
    pass: "Green hydrogen: SECI SIGHT programme + 5 MMT target. EV charging: FAME III. Smart metering: RDSS scheme ₹3.03L Cr",
    fail: "Refrigerant blending — mature commodity cycle. IT services — linear, not exponential. Traditional textiles.",
    note: "PRIMARY SIGNAL (max 5). If S10 ≥ 3, S1 auto-scores 3. If S10 = 5, S1 auto-scores 3 (its max). Look for QoQ revenue acceleration as the clearest proof of exponential traction — not management guidance.",
    scoring: {
      5: "QoQ revenue acceleration confirmed + India's #1 funded policy priority + proven tech + market 1000x in 15 yrs + early revenues growing >100% YoY",
      4: "Revenue accelerating >50% YoY with clear inflection + govt programme + proven technology + 100x market potential",
      3: "Govt programme + proven technology + early commercial revenues",
      2: "Clear govt intent but still pre-commercial or nascent revenues",
      1: "Adjacent to an exponential market, indirect benefit",
      0: "Mature, commoditised or linearly growing market"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {},
    },
    verificationSteps: [
      { step: 1, action: "Plot quarterly revenue for the last 6-8 quarters from Screener.in. Is QoQ growth accelerating (each quarter growing faster than the previous)? This is the #1 proof of exponential traction", source: "Screener.in → Quarterly Results → Sales row", evidenceRequired: "Last 6-8 quarters of revenue, QoQ growth % for each" },
      { step: 2, action: "Estimate the Total Addressable Market (TAM) in ₹ Cr. Source: NITI Aayog reports, sector research, Budget documents. What is the company's current share of this TAM?", source: "NITI Aayog, sector reports, government programme documents", evidenceRequired: "TAM in ₹ Cr, company's current market share" },
      { step: 3, action: "Identify the specific government programme(s) driving this market. Name the programme, its total budget outlay in ₹ Cr, and the year it was announced", source: "Union Budget, PM mission announcements, ministry programme documents", evidenceRequired: "Programme name, budget ₹ Cr, announcement year" },
      { step: 4, action: "Verify whether the technology is proven and deployed (not lab-stage or pilot). Has the company delivered commercial revenues from this market?", source: "Company investor presentations, annual report, exchange filings", evidenceRequired: "Evidence of commercial deployment and revenue from this market" },
      { step: 5, action: "Assess market growth trajectory: is this a 10x, 100x, or 1000x market over the next 10-15 years? Support with specific government targets (e.g., '500 GW renewable by 2030' vs current 200 GW)", source: "Government target documents, sector roadmaps", evidenceRequired: "Government target with year and current baseline" },
    ],
    notApplicableCondition: "NEVER — every company operates in a market of some size and growth profile. Even mature cyclical markets (score 0) must be explicitly verified, not assumed.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S11 — MASS LIFE IMPACT (max 3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S11", label: "Mass Life Impact", max: 3,
    what: "The company solves a problem that touches every Indian's daily life — waste, water, traffic, air quality, food safety, healthcare access. Demand is recurring and month-on-month compounding. Not niche B2B.",
    question: "Does the product touch >10 crore Indians daily? Is demand recurring?",
    source: "SECC census data, urban population density reports, MOSPI consumption surveys, TAM analysis",
    pass: "Waste management: every household generates ~1 kg/day — infinite recurring demand. Traffic tech: 30 Cr+ vehicles.",
    fail: "Sells railway enclosures to OEMs — B2B niche, not mass daily-life impact",
    note: "The test: does an average Indian encounter this problem every single day? If yes, demand is structurally infinite. Infrastructure enabling mass services (water pipelines, power transmission, railway signalling) counts even if end-user doesn't see the company name.",
    scoring: {
      3: "Every Indian affected daily — waste/water/traffic/food",
      2: "Large segment affected — healthcare/education/housing",
      1: "Millions affected but not universal",
      0: "B2B niche with no direct consumer touchpoint"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "Does the financial product serve mass-market needs? Retail lending for housing/education → mass impact. Niche corporate lending → low impact. Microfinance → high impact.",
        infrastructure: "Infrastructure enabling mass services (water, power, rail, roads) scores high even if B2B — the END USER is every Indian.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Identify the END beneficiary of the company's product/service. Is it an individual consumer, a business, or the public at large?", source: "Company website, annual report business description", evidenceRequired: "End beneficiary description" },
      { step: 2, action: "Estimate the number of Indians directly or indirectly affected. Use census data, urban/rural population splits, consumption surveys as reference", source: "SECC census, MOSPI reports, urban population data", evidenceRequired: "Estimated number of Indians affected daily/monthly" },
      { step: 3, action: "Assess recurring nature of demand: is this a one-time purchase (e.g., a house) or recurring (e.g., waste collection daily)? Recurring = structurally infinite demand", source: "Nature of the product/service — no specific data source needed", evidenceRequired: "Assessment of recurring vs one-time demand" },
      { step: 4, action: "For infrastructure/B2B companies: trace the chain to the end consumer. Railway signalling → affects every train passenger. Water treatment → affects every tap water user. Score accordingly.", source: "Trace the value chain", evidenceRequired: "Path from company's product to end consumer impact" },
    ],
    notApplicableCondition: "NEVER — every company either affects mass life or doesn't. Even niche B2B (score 0) is a valid assessment, but it must be explicitly reasoned, not assumed.",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // S12 — REVENUE QUALITY / PREDICTABILITY (max 3)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "S12", label: "Revenue Quality / Predictability", max: 3,
    what: "How predictable and recurring is the revenue? Investors heavily discount businesses where growth is real but cash collection is uncertain. A subscription-revenue company trades at a premium P/E to a lumpy EPC company at the same growth rate.",
    question: "Is revenue recurring/subscription (3), framework contracts (2), project EPC (1), or spot (0)?",
    source: "Annual report 'nature of business' section, con-call transcripts, revenue segment disclosures, debtor days trend",
    pass: "Long-term highway O&M maintenance contracts — 3–5 year recurring, predictable billing",
    fail: "Construction EPC — milestone billing, slow government payments, high payment risk",
    note: "Debtor days trend is a proxy: rising debtor days = deteriorating revenue quality even if topline looks good. A company with 90% revenue from repeat customers is higher quality than identical revenue from one-off contracts.",
    scoring: {
      3: "Recurring/subscription/SaaS-like revenue",
      2: "Multi-year framework contracts with blue-chip clients",
      1: "Project-based with PSU/govt clients — payment risk exists",
      0: "Spot tender / trading / one-off contracts"
    },
    applicability: {
      mandatory: ["epc","manufacturing","financial","infrastructure","services","trading","product"],
      optional: [],
      notApplicable: [],
      analogues: {
        financial: "Loan book quality (GNPA/NNPA), interest income predictability, fee income % (recurring). A retail loan book with EMI income is the most predictable.",
        manufacturing: "Repeat order % from existing customers. Auto ancillary with sole-supplier status to a major OEM = high predictability.",
        trading: "Long-term supply contracts with fixed prices = higher quality. Pure spot trading = 0.",
      },
    },
    verificationSteps: [
      { step: 1, action: "Read the 'Nature of Business' section in the annual report — how does the company describe its revenue model?", source: "Annual report → Business Overview", evidenceRequired: "Description of revenue model" },
      { step: 2, action: "Pull debtor days (receivables days) from Screener.in and check the trend over the last 3 years. Rising debtor days = declining revenue quality", source: "Screener.in → Efficiency Ratios", evidenceRequired: "Debtor days for last 3 years" },
      { step: 3, action: "Check revenue segment disclosures: what % of revenue comes from recurring sources (AMC, O&M, subscription) vs one-off (project, spot)?", source: "Annual report → Segment Reporting, investor presentations", evidenceRequired: "Revenue mix by type (recurring vs one-off)" },
      { step: 4, action: "Check customer concentration and repeat-customer rate. A company with 80% revenue from repeat customers has high predictability even if project-based", source: "Annual report, investor presentations", evidenceRequired: "Customer repeat rate, top customer concentration" },
      { step: 5, action: "For EPC/infrastructure: check client type. Central govt/PSU clients = payment risk exists but default risk is low. State govt/municipal clients = higher payment risk. Private clients = check their credit quality.", source: "Annual report client disclosures", evidenceRequired: "Client type breakdown" },
    ],
    notApplicableCondition: "NEVER — every company has some revenue quality profile, even if it's pure spot. Score what exists.",
  },
];

// Total max = 41 (S3 + S4 + S9 + S10 = 5 each = 20; rest = 21)
export const MAX_SCORE = SIGNALS.reduce((a, s) => a + s.max, 0);

// Scoring bands — proportional thresholds on the 41-point scale
// ≥29 (71%) = STRONG BUY, 21-28 (51-68%) = WATCHLIST, 14-20 (34-49%) = INVESTIGATE, <14 = AVOID
export const BANDS = [
  { min: 29, label: "STRONG BUY",  color: "#22c55e", bg: "#022c11", desc: "Research deeply, build position. Very rare — verify order book + market cap independently." },
  { min: 21, label: "WATCHLIST",   color: "#f59e0b", bg: "#1c1005", desc: "Set a specific entry trigger. Wait for a catalytic event before buying." },
  { min: 14, label: "INVESTIGATE", color: "#f97316", bg: "#1c0e05", desc: "Check blockers — can they resolve? Annual report + quarterly results needed." },
  { min: 0,  label: "AVOID",       color: "#ef4444", bg: "#1f0505", desc: "Do not invest. Eliminate from list entirely." },
] as const;

export function getBand(score: number) {
  return BANDS.find(b => score >= b.min) ?? BANDS[3];
}
