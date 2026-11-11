/**
 * Portfolio review: re-scores every stock in a Zerodha holdings export through
 * the 12-Signal Framework and compares each new score with the report that was
 * on file before the run.
 *
 * Usage:
 *   npx tsx scripts/analyze-portfolio.ts --holdings ~/Downloads/holdings.csv
 *
 * Options:
 *   --holdings <csv>    Zerodha Console/Kite holdings export (required)
 *   --baseline <csv>    An older holdings export; adds price change since then
 *   --only A,B,C        Only these instruments
 *   --concurrency <n>   Stocks analysed at once (default 2; each makes 12 model calls)
 *   --rescore           Score again even if already done today (use with --only)
 *   --dry-run           Resolve symbols and show the scores on file; no model calls
 *
 * Output goes to portfolio-runs/<date>.json and .md (git-ignored: it holds your
 * holdings). Re-running on the same day resumes and skips stocks already done.
 * A stock's stored report is only replaced when all 12 signals come back.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Load env (before anything reads process.env) ─────────────────────
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf-8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i === -1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, i).trim()] = v;
}

import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { SIGNALS, getBand, MAX_SCORE } from "../lib/signals";
import {
  analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, ANALYSIS_MODEL, usageTotals,
  type SignalResult,
} from "../lib/claude";
import { fetchScreenerData, formatScreenerContext } from "../lib/screener";
import { fetchSignalContext } from "../lib/search";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ─── Args ─────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const expand = (p: string) => path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));

const HOLDINGS = arg("holdings");
const BASELINE = arg("baseline");
const ONLY = arg("only")?.split(",").map(s => s.trim().toUpperCase());
const CONCURRENCY = Math.max(1, parseInt(arg("concurrency") ?? "2"));
const DRY_RUN = process.argv.includes("--dry-run");
const RESCORE = process.argv.includes("--rescore");

if (!HOLDINGS) {
  console.error("Usage: npx tsx scripts/analyze-portfolio.ts --holdings <holdings.csv> [--baseline <old.csv>] [--only A,B] [--dry-run]");
  process.exit(1);
}

// ─── Holdings ─────────────────────────────────────────────────────────

interface Holding { instrument: string; qty: number; avgCost: number; ltp: number; invested: number; value: number; pnl: number }

function readHoldings(file: string): Holding[] {
  const { data } = Papa.parse<Record<string, string>>(fs.readFileSync(expand(file), "utf-8"), { header: true, skipEmptyLines: true });
  const num = (v: string | undefined) => parseFloat((v ?? "").replace(/,/g, "")) || 0;
  return data
    .map(r => {
      const qty = num(r["Qty."]), avgCost = num(r["Avg. cost"]), ltp = num(r["LTP"]);
      const invested = num(r["Invested"]) || qty * avgCost;
      const value = num(r["Cur. val"]) || qty * ltp;
      return { instrument: (r["Instrument"] ?? "").trim().toUpperCase(), qty, avgCost, ltp, invested, value, pnl: value - invested };
    })
    .filter(h => h.instrument && h.qty > 0);
}

// ─── Symbol resolution ────────────────────────────────────────────────

interface Previous { total: number; band: string; analyzedAt: string | null; signals: Record<string, number> }
interface Target { holding: Holding; symbol: string; exchange: string; name: string; previous: Previous | null }

// Zerodha appends a series suffix (KRN-BE, AIMTRON-SM); reports may be stored with or without it.
const baseSymbol = (s: string) => s.replace(/-(BE|BZ|SM|ST|BL|IL|E1|X1)$/, "");
const byExchange = <T extends { exchange: string }>(a: T, b: T) => (a.exchange === "NSE" ? 0 : 1) - (b.exchange === "NSE" ? 0 : 1);

async function resolve(holding: Holding): Promise<Target | null> {
  const candidates = [...new Set([holding.instrument, baseSymbol(holding.instrument)])];

  const { data: reports } = await supabase.from("reports")
    .select("id, symbol, exchange, company_name, total_score, band, analyzed_at")
    .in("symbol", candidates).not("total_score", "is", null);
  // Holdings are NSE-first, so prefer the NSE report; then the most recent.
  const prior = (reports ?? []).sort((a, b) =>
    byExchange(a, b) || (b.analyzed_at ?? "").localeCompare(a.analyzed_at ?? ""))[0];

  if (prior) {
    const { data: sigs } = await supabase.from("report_signals").select("signal_id, score").eq("report_id", prior.id);
    return {
      holding, symbol: prior.symbol, exchange: prior.exchange, name: prior.company_name,
      previous: {
        total: prior.total_score, band: prior.band, analyzedAt: prior.analyzed_at,
        signals: Object.fromEntries((sigs ?? []).map(s => [s.signal_id, s.score])),
      },
    };
  }

  const { data: inst } = await supabase.from("instruments").select("symbol, exchange, name").in("symbol", candidates);
  const match = (inst ?? []).sort((a, b) =>
    byExchange(a, b) || candidates.indexOf(a.symbol) - candidates.indexOf(b.symbol))[0];
  if (match) return { holding, symbol: match.symbol, exchange: match.exchange, name: match.name, previous: null };

  // The instruments table can lag new listings; fall back to Screener's own search.
  const sym = baseSymbol(holding.instrument);
  const sd = await fetchScreenerData(sym, "NSE").catch(() => null);
  return sd ? { holding, symbol: sym, exchange: "NSE", name: sd.companyName, previous: null } : null;
}

// ─── Analyse one stock ────────────────────────────────────────────────

// Set when the API rejects the account (no credit, bad key); stops the whole run.
let accountError: string | null = null;

interface Scored { total: number; band: string; businessModel: string | null; summary: string; signals: Record<string, number> }

async function analyse(t: Target): Promise<Scored> {
  const [sd, searchCtx] = await Promise.all([
    fetchScreenerData(t.symbol, t.exchange).catch(() => null),
    fetchSignalContext(t.name).catch(() => ""),
  ]);
  const name = sd?.companyName ?? t.name;
  const dataContext = (sd ? formatScreenerContext(sd) : "") + searchCtx;
  if (!dataContext) throw new Error("no Screener or web data — refusing to score from memory");

  const signals: SignalResult[] = [];
  let businessModel: string | null = null;

  const run = async (groups: readonly (readonly string[])[]) => {
    await Promise.all(groups.map(async group => {
      try {
        const r = await analyzeSignalGroup(t.symbol, t.exchange, name, group, dataContext, true);
        signals.push(...r.signals);
        businessModel ??= r.businessModel;
      } catch (e) {
        console.warn(`   ${t.symbol} [${group.join(",")}] failed: ${String(e).slice(0, 120)}`);
        // No point retrying or moving to the next stock if the account itself is the problem.
        if (/credit balance|authentication_error|invalid x-api-key/i.test(String(e))) accountError = String(e).slice(0, 200);
      }
    }));
  };

  // First signal alone so it writes the prompt cache; the other eleven then read it.
  await run(SIGNAL_GROUPS.slice(0, 1));
  await run(SIGNAL_GROUPS.slice(1));
  const missing = () => SIGNALS.filter(s => !signals.some(r => r.signal_id === s.id)).map(s => s.id);
  if (accountError) throw new Error("API account error — run stopped");
  if (missing().length) await run(missing().map(id => [id]));   // one retry
  if (missing().length) throw new Error(`incomplete: missing ${missing().join(",")} — stored report left untouched`);

  const total = signals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total).label;
  const summary = await generateSummary(t.symbol, t.exchange, name, signals, band, total, MAX_SCORE, dataContext).catch(() => "");

  // Replace the stored report only now that the new one is complete.
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: report, error } = await supabase.from("reports")
    .upsert({ symbol: t.symbol, exchange: t.exchange, company_name: name, expires_at: expiresAt }, { onConflict: "symbol,exchange" })
    .select("id").single();
  if (error || !report) throw new Error(`report upsert failed: ${error?.message}`);

  await supabase.from("report_signals").delete().eq("report_id", report.id);
  const { error: sigErr } = await supabase.from("report_signals").insert(signals.map(s => ({
    report_id: report.id, signal_id: s.signal_id, label: s.label,
    score: s.score, max_score: s.max_score, reasoning: s.reasoning, sources: s.sources,
  })));
  if (sigErr) throw new Error(`signal insert failed: ${sigErr.message}`);

  await supabase.from("reports").update({
    status: "complete", total_score: total, max_score: MAX_SCORE, band, summary,
    business_model: businessModel, analyzed_at: new Date().toISOString(),
  }).eq("id", report.id);

  return { total, band, businessModel, summary, signals: Object.fromEntries(signals.map(s => [s.signal_id, s.score])) };
}

// ─── Run file ─────────────────────────────────────────────────────────

interface Row {
  instrument: string; symbol: string; exchange: string; name: string;
  holding: Holding; previous: Previous | null; current: Scored | null; error?: string;
  priceThen?: number;
}

const OUT_DIR = path.join(ROOT, "portfolio-runs");
const stamp = new Date().toISOString().slice(0, 10);
const JSON_OUT = path.join(OUT_DIR, `${stamp}.json`);
const MD_OUT = path.join(OUT_DIR, `${stamp}.md`);
const BASELINE_SCORES = path.join(OUT_DIR, "baseline-scores.json");

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function render(rows: Row[]): string {
  const lines = [
    `# Portfolio review — ${stamp}`,
    "",
    `Model: ${ANALYSIS_MODEL}. Scores are out of ${MAX_SCORE}. "Before" is the report on file when this run started.`,
    "",
    "| Stock | Before | When | Now | Change | Band now | P&L on cost |" + (BASELINE ? " Price since baseline |" : ""),
    "|---|---|---|---|---|---|---|" + (BASELINE ? "---|" : ""),
  ];
  const sorted = [...rows].sort((a, b) => (b.current?.total ?? -1) - (a.current?.total ?? -1));
  for (const r of sorted) {
    const before = r.previous ? `${r.previous.total} ${r.previous.band}` : "—";
    const when = r.previous?.analyzedAt?.slice(0, 10) ?? "—";
    const now = r.current ? String(r.current.total) : (r.error ? "failed" : "not run");
    const delta = r.current && r.previous ? `${r.current.total - r.previous.total >= 0 ? "+" : ""}${r.current.total - r.previous.total}` : "—";
    const pnl = r.holding.invested ? pct((r.holding.pnl / r.holding.invested) * 100) : "—";
    const since = BASELINE ? ` ${r.priceThen ? pct((r.holding.ltp / r.priceThen - 1) * 100) : "new"} |` : "";
    lines.push(`| ${r.instrument} | ${before} | ${when} | ${now} | ${delta} | ${r.current?.band ?? "—"} | ${pnl} |${since}`);
  }
  for (const r of sorted) {
    if (r.current?.summary) lines.push("", `## ${r.instrument} — ${r.current.total}/${MAX_SCORE} ${r.current.band}`, "", r.current.summary);
    if (r.current && r.previous) {
      const moved = SIGNALS.filter(s => r.previous!.signals[s.id] !== undefined && r.previous!.signals[s.id] !== r.current!.signals[s.id])
        .map(s => `${s.id} ${s.label}: ${r.previous!.signals[s.id]} → ${r.current!.signals[s.id]}`);
      if (moved.length) lines.push("", `Signals that moved: ${moved.join("; ")}.`);
    }
  }
  return lines.join("\n") + "\n";
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const holdings = readHoldings(HOLDINGS!).filter(h => !ONLY || ONLY.includes(h.instrument));
  const baseline = BASELINE ? new Map(readHoldings(BASELINE).map(h => [h.instrument, h.ltp])) : null;
  if (!holdings.length) throw new Error("No holdings found — is this a Zerodha holdings CSV?");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const prior: Row[] = fs.existsSync(JSON_OUT) ? JSON.parse(fs.readFileSync(JSON_OUT, "utf-8")).rows : [];
  const baselineScores: Record<string, Previous | null> = fs.existsSync(BASELINE_SCORES) ? JSON.parse(fs.readFileSync(BASELINE_SCORES, "utf-8")) : {};
  // Rows from earlier today that this run doesn't touch (e.g. under --only) are carried over, not dropped.
  const rows: Row[] = prior.filter(r => !holdings.some(h => h.instrument === r.instrument));
  const todo: { row: Row; target: Target }[] = [];

  for (const h of holdings) {
    const done = RESCORE ? undefined : prior.find(r => r.instrument === h.instrument && r.current);
    if (done) { rows.push({ ...done, holding: h, priceThen: baseline?.get(h.instrument) }); continue; }   // resume
    const target = await resolve(h);
    if (target) {
      // The first score ever seen for a stock is its baseline; later runs compare against it, not against themselves.
      // "No score on file" is recorded too (as null), so a later re-score isn't mistaken for a baseline.
      if (h.instrument in baselineScores) target.previous = baselineScores[h.instrument];
      else baselineScores[h.instrument] = target.previous;
    }
    if (!target) {
      rows.push({ instrument: h.instrument, symbol: h.instrument, exchange: "?", name: h.instrument, holding: h, previous: null, current: null, error: "not found in instruments table or on Screener" });
      continue;
    }
    const row: Row = {
      instrument: h.instrument, symbol: target.symbol, exchange: target.exchange, name: target.name,
      holding: h, previous: target.previous, current: null, priceThen: baseline?.get(h.instrument),
    };
    rows.push(row);
    todo.push({ row, target });
  }

  const save = () => {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ date: stamp, model: ANALYSIS_MODEL, rows }, null, 2));
    fs.writeFileSync(MD_OUT, render(rows));
  };

  if (!DRY_RUN) fs.writeFileSync(BASELINE_SCORES, JSON.stringify(baselineScores, null, 2));
  console.log(`\n${holdings.length} holdings · ${holdings.length - todo.length} already done or unresolved · ${todo.length} to analyse with ${ANALYSIS_MODEL}\n`);
  if (DRY_RUN) {
    for (const r of rows) console.log(`${r.instrument.padEnd(14)} → ${r.exchange}:${r.symbol.padEnd(14)} ${r.previous ? `${r.previous.total}/${MAX_SCORE} ${r.previous.band} (${r.previous.analyzedAt?.slice(0, 10)})` : (r.error ?? "no report on file")}`);
    return;
  }

  const start = Date.now();
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length && !accountError) {
      const { row, target } = todo[next++];
      const t0 = Date.now();
      try {
        row.current = await analyse(target);
        const d = row.previous ? ` (was ${row.previous.total} ${row.previous.band})` : "";
        console.log(`✓ ${row.instrument.padEnd(14)} ${String(row.current.total).padStart(2)}/${MAX_SCORE} ${row.current.band}${d} · ${Math.round((Date.now() - t0) / 1000)}s`);
      } catch (e) {
        row.error = String(e instanceof Error ? e.message : e);
        console.log(`✗ ${row.instrument.padEnd(14)} ${row.error.slice(0, 100)}`);
      }
      save();
    }
  }));
  save();
  if (accountError) console.log(`\nStopped early: ${accountError}\nFix the account, then re-run the same command to resume.`);

  // Fable 5.2 list price per million tokens: $8 input, $40 output, $10 cache write, $0.20 cache read.
  const cost = (usageTotals.input_tokens * 8 + usageTotals.output_tokens * 40
    + usageTotals.cache_write_tokens * 10 + usageTotals.cache_read_tokens * 0.2) / 1e6;
  console.log(`\nDone in ${Math.round((Date.now() - start) / 1000)}s · ${usageTotals.calls} model calls · ${usageTotals.input_tokens.toLocaleString()} in / ${usageTotals.output_tokens.toLocaleString()} out / ${usageTotals.cache_read_tokens.toLocaleString()} cached · about $${cost.toFixed(2)} at list price`);
  console.log(`Report: ${MD_OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
