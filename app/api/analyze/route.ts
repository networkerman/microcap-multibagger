import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createAuthClient } from "@/lib/supabase/server-auth";
import { analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, type SignalResult } from "@/lib/claude";
import { getBand, MAX_SCORE } from "@/lib/signals";
import { sendReportReadyEmail } from "@/lib/resend";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";

export const maxDuration = 60;

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

async function runAnalysis(
  supabase: ReturnType<typeof createServiceClient>,
  reportId: string,
  symbol: string,
  exchange: string,
  companyName: string,
) {
  const screenerData = await fetchScreenerData(symbol, exchange);
  const dataContext = screenerData ? formatScreenerContext(screenerData) : "";

  if (screenerData) {
    await supabase.from("reports")
      .update({ company_name: screenerData.companyName })
      .eq("id", reportId);
  }

  const allSignals: SignalResult[] = [];

  try {
    await Promise.all(
      SIGNAL_GROUPS.map(group =>
        analyzeSignalGroup(symbol, exchange, companyName, group, dataContext)
          .then(async (signals) => {
            allSignals.push(...signals);
            await persistSignals(supabase, reportId, signals);
          })
      )
    );
  } catch (err) {
    await supabase.from("reports").update({ status: "failed" }).eq("id", reportId);
    return;
  }

  const total_score = allSignals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total_score);
  let summary = "";
  try {
    summary = await generateSummary(symbol, exchange, companyName, allSignals, band.label, total_score, MAX_SCORE, dataContext);
  } catch { /* non-fatal */ }

  await supabase.from("reports").update({
    status: "complete",
    total_score,
    max_score: MAX_SCORE,
    band: band.label,
    summary,
    analyzed_at: new Date().toISOString(),
  }).eq("id", reportId);

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
