import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, type SignalResult } from "@/lib/claude";
import { getBand, MAX_SCORE } from "@/lib/signals";
import { sendReportReadyEmail } from "@/lib/resend";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";

// Extend Vercel serverless timeout to 60s (max on Hobby plan).
// The route returns 202 immediately; actual analysis runs in after() background task.
export const maxDuration = 60;

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
  // Fetch real financial data to ground Claude with verified numbers
  const screenerData = await fetchScreenerData(symbol, exchange);
  const dataContext = screenerData ? formatScreenerContext(screenerData) : "";

  if (screenerData) {
    await supabase.from("reports")
      .update({ company_name: screenerData.companyName })
      .eq("id", reportId);
  }

  // Fire all 3 signal groups simultaneously; each saves to DB as it completes
  // so the polling client sees progressive results
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://invest-growth.com";
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

  const supabase = createServiceClient();
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Upsert report row as "analyzing"
  const { data: report, error: upsertErr } = await supabase
    .from("reports")
    .upsert(
      { symbol, exchange, company_name: companyName, status: "analyzing", expires_at: expiresAt },
      { onConflict: "symbol,exchange" }
    )
    .select()
    .single();

  if (upsertErr || !report) {
    return NextResponse.json({ error: upsertErr?.message ?? "upsert failed" }, { status: 500 });
  }

  // Clear old signal rows
  await supabase.from("report_signals").delete().eq("report_id", report.id);

  // Store email before returning (so we can notify even if something goes wrong)
  if (email) {
    await supabase.from("notification_requests").insert({ report_id: report.id, email });
  }

  // Return 202 immediately so the UI can start polling and showing the skeleton
  after(() => runAnalysis(supabase, report.id, symbol, exchange, companyName));

  return NextResponse.json({ ok: true, report_id: report.id }, { status: 202 });
}
