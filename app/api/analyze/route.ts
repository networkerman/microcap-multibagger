import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createAuthClient } from "@/lib/supabase/server-auth";
// Signal scoring uses DeepSeek by default (cheaper, fast, good at structured JSON).
// Falls back to Claude (lib/claude.ts) if DEEPSEEK_API_KEY is not set.
import { analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, type SignalResult } from "@/lib/deepseek";
import { analyzeSignalGroup as claudeAnalyzeGroup, generateSummary as claudeSummary } from "@/lib/claude";
import { getBand, MAX_SCORE, SIGNALS } from "@/lib/signals";
import { checkRateLimit, clientIp, findInstrument } from "@/lib/rate-limit";
import { sendReportReadyEmail } from "@/lib/resend";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";
import { fetchSignalContext } from "@/lib/search";

export const maxDuration = 300;

// Prefer DeepSeek for signal scoring; fall back to Claude if key is missing
function getAnalyzeGroup() {
  return process.env.DEEPSEEK_API_KEY ? analyzeSignalGroup : claudeAnalyzeGroup;
}
function getGenerateSummary() {
  return process.env.DEEPSEEK_API_KEY ? generateSummary : claudeSummary;
}

// Rate limit: N analyses per IP per hour. Override via RATE_LIMIT_HOURLY env var.
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_HOURLY ?? "5");

const REPORT_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
// An "analyzing" report older than this is treated as abandoned and may be restarted.
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

async function persistSignals(supabase: ReturnType<typeof createServiceClient>, reportId: string, signals: SignalResult[]) {
  if (signals.length === 0) return;
  await supabase.from("report_signals").insert(
    signals.map(s => ({
      report_id: reportId,
      signal_id: s.signal_id,
      label: s.label,
      score: s.score,
      max_score: s.max_score,
      reasoning: s.reasoning,
      sources: s.sources,
    }))
  );
}

function elapsed(start: number) { return `${((Date.now() - start) / 1000).toFixed(1)}s`; }

async function runAnalysis(
  supabase: ReturnType<typeof createServiceClient>,
  reportId: string,
  symbol: string,
  exchange: string,
  companyName: string,
) {
  const t0 = Date.now();
  console.log(`[analyze:start] ${exchange}:${symbol} — "${companyName}" | reportId=${reportId}`);

  // ── Step 1: Data fetching ──────────────────────────────────────────────────
  const t1 = Date.now();
  console.log(`[analyze:fetch] Starting Screener.in + web search in parallel`);
  const [screenerData, tavilyContext] = await Promise.all([
    fetchScreenerData(symbol, exchange),
    fetchSignalContext(companyName),
  ]);
  console.log(`[analyze:fetch] Done in ${elapsed(t1)} | screener=${screenerData ? "ok" : "null"} | webContext=${tavilyContext.length} chars`);

  const dataContext = (screenerData ? formatScreenerContext(screenerData) : "") + tavilyContext;
  console.log(`[analyze:context] Total context size: ${dataContext.length} chars`);

  if (screenerData) {
    await supabase.from("reports")
      .update({ company_name: screenerData.companyName })
      .eq("id", reportId);
    console.log(`[analyze:screener] Company name updated to: "${screenerData.companyName}"`);
  } else {
    console.warn(`[analyze:screener] No Screener.in data found for ${exchange}:${symbol} — scoring with web context only`);
  }

  // ── Step 2: Signal scoring ─────────────────────────────────────────────────
  const allSignals: SignalResult[] = [];
  let businessModel: string | null = null;
  const scoreGroup = getAnalyzeGroup();
  const summarize = getGenerateSummary();
  const provider = process.env.DEEPSEEK_API_KEY ? "deepseek" : "claude";
  console.log(`[analyze:scoring] Starting ${SIGNAL_GROUPS.length} signal calls in parallel via ${provider}`);

  const scoreGroups = (groups: readonly (readonly string[])[]) => Promise.all(
    groups.map(group => {
      const tGroup = Date.now();
      console.log(`[analyze:group] Starting group [${group.join(",")}]`);
      return scoreGroup(symbol, exchange, companyName, group, dataContext)
        .then(async ({ signals, businessModel: bm }) => {
          const scores = signals.map(s => `${s.signal_id}=${s.score}/${s.max_score}`).join(" ");
          console.log(`[analyze:group] [${group.join(",")}] done in ${elapsed(tGroup)} | ${signals.length} signals | ${scores}`);
          allSignals.push(...signals);
          if (bm && !businessModel) {
            businessModel = bm;
            console.log(`[analyze:group] Business model classified as: ${bm}`);
          }
          await persistSignals(supabase, reportId, signals);
        })
        .catch(err => {
          // One signal failing must not kill the whole analysis.
          // Log it and continue — the report will complete with the remaining signals.
          console.error(`[analyze:group] [${group.join(",")}] FAILED after ${elapsed(tGroup)}:`, err);
        });
    })
  );

  await scoreGroups(SIGNAL_GROUPS);

  // Retry whatever is missing once. A total built from fewer than all signals
  // understates the score, so an incomplete report is marked failed, never complete.
  const missing = () => SIGNALS.filter(s => !allSignals.some(r => r.signal_id === s.id)).map(s => s.id);
  if (missing().length) {
    console.warn(`[analyze:scoring] Retrying missing signals: ${missing().join(",")}`);
    await scoreGroups(missing().map(id => [id]));
  }
  if (missing().length) {
    console.error(`[analyze:scoring] Still missing ${missing().join(",")} — marking failed | ${exchange}:${symbol}`);
    await supabase.from("reports").update({ status: "failed" }).eq("id", reportId);
    return;
  }

  console.log(`[analyze:scoring] All groups complete in ${elapsed(t0)} | total signals: ${allSignals.length}`);

  // ── Step 3: Score + summary ────────────────────────────────────────────────
  const total_score = allSignals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total_score);
  console.log(`[analyze:score] total=${total_score}/${MAX_SCORE} | band=${band.label}`);

  let summary = "";
  try {
    const tSum = Date.now();
    summary = await summarize(symbol, exchange, companyName, allSignals, band.label, total_score, MAX_SCORE, dataContext);
    console.log(`[analyze:summary] Generated in ${elapsed(tSum)} | ${summary.length} chars`);
  } catch (err) {
    console.error(`[analyze:summary] Failed (non-fatal):`, err);
  }

  await supabase.from("reports").update({
    status: "complete",
    total_score,
    max_score: MAX_SCORE,
    band: band.label,
    summary,
    business_model: businessModel,
    analyzed_at: new Date().toISOString(),
  }).eq("id", reportId);
  console.log(`[analyze:done] ${exchange}:${symbol} completed in ${elapsed(t0)} | score=${total_score} | band=${band.label}`);

  // Notify subscribers
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://microcap-multibagger.vercel.app";
  const reportUrl = `${appUrl}/stock/${exchange}:${symbol}`;
  const { data: pendingNotifs } = await supabase
    .from("notification_requests")
    .select("id, email")
    .eq("report_id", reportId)
    .is("notified_at", null);

  const resolvedCompanyName = screenerData?.companyName ?? companyName;
  for (const notif of pendingNotifs ?? []) {
    if (!notif.email) continue;
    try {
      await sendReportReadyEmail({ to: notif.email, companyName: resolvedCompanyName, symbol, exchange, totalScore: total_score, band: band.label, reportUrl });
      await supabase.from("notification_requests").update({ notified_at: new Date().toISOString() }).eq("id", notif.id);
    } catch { /* non-fatal */ }
  }
}

export async function POST(req: Request) {
  const body = await req.json() as { symbol?: string; exchange?: string; email?: string };
  const symbol = body.symbol?.trim().toUpperCase();
  const exchange = body.exchange?.trim().toUpperCase();
  const email = body.email?.trim();

  if (!symbol || !exchange) {
    return NextResponse.json({ error: "symbol and exchange required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Only listed instruments can be analysed, and the company name comes from our table.
  const instrument = await findInstrument(supabase, symbol, exchange);
  if (!instrument) {
    return NextResponse.json({ error: "Unknown instrument" }, { status: 404 });
  }
  const companyName = instrument.name;

  // A fresh report, or one already being built, is returned as-is. Without this
  // any caller could wipe a finished report and trigger a paid re-analysis.
  const { data: existing } = await supabase
    .from("reports")
    .select("id, status, expires_at, analyzed_at")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .maybeSingle();

  if (existing?.expires_at) {
    const expiresAt = new Date(existing.expires_at).getTime();
    // "Refresh analysis" is honoured once a report is a week old; before that it is served as-is.
    const fresh = existing.status === "complete" && !!existing.analyzed_at
      && Date.now() - new Date(existing.analyzed_at).getTime() < REFRESH_AFTER_MS;
    // expires_at is set to start + 90 days when a run begins, so it doubles as the start time.
    const running = existing.status === "analyzing" && Date.now() - (expiresAt - REPORT_TTL_MS) < RUN_TIMEOUT_MS;
    if (fresh || running) {
      if (running && email) {
        await supabase.from("notification_requests").insert({ report_id: existing.id, email });
      }
      return NextResponse.json({ ok: true, report_id: existing.id, cached: true });
    }
  }

  // --- Rate limiting ---
  if (!(await checkRateLimit(supabase, clientIp(req), "analyze", RATE_LIMIT))) {
    return NextResponse.json(
      { error: `Rate limit reached. Max ${RATE_LIMIT} analyses per hour per IP.` },
      { status: 429 }
    );
  }

  // --- Session cookie (anonymous tracking) ---
  const sessionId = req.headers.get("cookie")
    ?.split(";")
    .find(c => c.trim().startsWith("mmb_session="))
    ?.split("=")[1]?.trim()
    ?? crypto.randomUUID();

  // --- Logged-in user (optional) ---
  let triggeredBy: string | null = null;
  try {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    triggeredBy = user?.id ?? null;
  } catch { /* non-fatal — analysis is always public */ }

  // --- Upsert report ---
  const expiresAt = new Date(Date.now() + REPORT_TTL_MS).toISOString();
  const { data: report, error: upsertErr } = await supabase
    .from("reports")
    .upsert(
      {
        symbol,
        exchange,
        company_name: companyName,
        status: "analyzing",
        expires_at: expiresAt,
        session_id: sessionId,
        triggered_by: triggeredBy,
      },
      { onConflict: "symbol,exchange" }
    )
    .select()
    .single();

  if (upsertErr || !report) {
    return NextResponse.json({ error: upsertErr?.message ?? "upsert failed" }, { status: 500 });
  }

  await supabase.from("report_signals").delete().eq("report_id", report.id);

  if (email) {
    await supabase.from("notification_requests").insert({ report_id: report.id, email });
  }

  // Return 202 immediately; analysis runs in the background
  after(() => runAnalysis(supabase, report.id, symbol, exchange, companyName));

  const response = NextResponse.json({ ok: true, report_id: report.id }, { status: 202 });

  // Set / refresh the anonymous session cookie (1 year, httpOnly)
  response.cookies.set("mmb_session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return response;
}
