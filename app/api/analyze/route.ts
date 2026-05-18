import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createAuthClient } from "@/lib/supabase/server-auth";
// Signal scoring uses DeepSeek by default (cheaper, fast, good at structured JSON).
// Falls back to Claude (lib/claude.ts) if DEEPSEEK_API_KEY is not set.
import { analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, type SignalResult } from "@/lib/deepseek";
import { analyzeSignalGroup as claudeAnalyzeGroup, generateSummary as claudeSummary } from "@/lib/claude";
import { getBand, MAX_SCORE } from "@/lib/signals";
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
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkRateLimit(ip: string, supabase: ReturnType<typeof createServiceClient>): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString();

  const { count } = await supabase
    .from("rate_limit_log")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("endpoint", "analyze")
    .gte("created_at", windowStart);

  if ((count ?? 0) >= RATE_LIMIT) return false;

  // Log this request (fire and forget — don't block the response)
  supabase.from("rate_limit_log").insert({ ip, endpoint: "analyze" }).then(() => {});
  return true;
}

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
  console.log(`[analyze:scoring] Starting 3 signal groups in parallel via ${provider}`);

  try {
    await Promise.all(
      SIGNAL_GROUPS.map(group => {
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
          });
      })
    );
  } catch (err) {
    console.error(`[analyze:scoring] FAILED after ${elapsed(t0)}:`, err);
    await supabase.from("reports").update({ status: "failed" }).eq("id", reportId);
    return;
  }

  // If all groups silently returned nothing, treat as a failure rather than
  // marking the report "complete" with a misleading score of 0.
  if (allSignals.length === 0) {
    console.error(`[analyze:scoring] All groups returned empty signals — marking failed | ${exchange}:${symbol}`);
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
  const { symbol, exchange, companyName, email } = await req.json() as {
    symbol: string; exchange: string; companyName: string; email?: string;
  };

  if (!symbol || !exchange || !companyName) {
    return NextResponse.json({ error: "symbol, exchange, companyName required" }, { status: 400 });
  }

  // --- Rate limiting ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const supabase = createServiceClient();
  const allowed = await checkRateLimit(ip, supabase);
  if (!allowed) {
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
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
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
