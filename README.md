# Microcap Multibagger — 12-Signal Stock Analyser

An open-source, AI-powered stock analysis tool for Indian microcap and smallcap stocks listed on NSE and BSE.

Built on the **12-Signal Framework** — a scoring system designed to find policy-driven, high-growth Indian companies before the market does.

**Live scoring bands:**
| Score | Rating |
|---|---|
| ≥ 26 / 36 | STRONG BUY |
| 18–25 | WATCHLIST |
| 12–17 | INVESTIGATE |
| < 12 | AVOID |

---

## How it works

1. User searches for any NSE/BSE listed stock
2. If a report exists (< 90 days old), it's shown immediately
3. If not, user enters their email and triggers an AI analysis
4. Claude Sonnet analyses all 12 signals using public exchange filings, screener.in data, credit rating databases, and more
5. Report is stored publicly — the next person searching the same stock gets it instantly
6. User is notified by email when the report is ready

---

## The 12 Signals

| # | Signal | Max |
|---|---|---|
| S1 | Sector Tailwind | 3 |
| S2 | Order Book > 2x Mcap | 3 |
| S3 | Product / Service Quality | 3 |
| S4 | Strong Financials | 3 |
| S5 | Promoter Quality & Connections | 3 |
| S6 | Credit Rating | 2 |
| S7 | Employee Satisfaction | 2 |
| S8 | Long-term Expansion Plan | 2 |
| S9 | Undervalued vs Growth (PEG) | 3 |
| S10 | Exponential Market | 3 |
| S11 | Mass Life Impact | 3 |
| S12 | Revenue Quality / Predictability | 3 |
| | **Total** | **36** |

---

## Stack

- **Frontend + API**: Next.js 16 (App Router, TypeScript)
- **Database**: Supabase (Postgres)
- **Stock instrument list**: [Kite API](https://api.kite.trade/instruments) — NSE + BSE, ~10k EQ stocks, no auth required
- **AI scoring**: Claude Sonnet (`claude-sonnet-4-6`) via Anthropic API
- **Email notifications**: Resend
- **Hosting**: Vercel

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/microcap-multibagger
cd microcap-multibagger
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL editor
3. Copy your project URL and keys

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

ANTHROPIC_API_KEY=

RESEND_API_KEY=
FROM_EMAIL=reports@yourdomain.com

SYNC_SECRET=any_random_string_you_choose
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Sync the instrument list

After starting the server, run once to populate NSE + BSE stocks:

```bash
curl -X POST http://localhost:3000/api/sync-instruments \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

Loads ~10,000 NSE + BSE equity instruments. Re-run daily to stay fresh.

### 5. Run locally

```bash
npm run dev
```

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in Vercel
3. Add all env vars in Vercel dashboard
4. Set `NEXT_PUBLIC_APP_URL` to your production URL
5. After first deploy, trigger `POST /api/sync-instruments` with your `SYNC_SECRET`

Add a Vercel Cron to keep instruments fresh (`vercel.json`):

```json
{
  "crons": [{ "path": "/api/sync-instruments", "schedule": "0 1 * * *" }]
}
```

Note: Vercel Cron doesn't send auth headers — for the cron job, either remove the auth check or use a different trigger mechanism.

---

## Framework versioning

All 12 signals, weights, and scoring bands live in one file: [`lib/signals.ts`](lib/signals.ts).

To add, remove, or reweight signals — edit only that file. The UI, AI prompt, and database all derive from it automatically.

---

## Disclaimer

Personal investment research only. Not financial advice. Always do your own due diligence.
