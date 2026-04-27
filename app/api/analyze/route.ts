import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeSignalGroup, generateSummary, SIGNAL_GROUPS, type SignalResult } from "@/lib/claude";
import { getBand, MAX_SCORE } from "@/lib/signals";
import { sendReportReadyEmail } from "@/lib/resend";

// Extend Vercel serverless timeout to 60s (max on Hobby plan).
// With 3 parallel Claude calls of ~4 signals each, total time is ~15-25s.
export const maxDuration = 60;

async function persistSignals(supabase: ReturnType<typeof createServiceClient>, reportId: string, signals: SignalResult[]) {
  if (signals.length === 0) return;
  // Groups are non-overlapping so plain insert is safe.
  // Old rows are deleted at the start of each analyze run.
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

  // Clear old signal rows so upsert below works cleanly on refresh
  await supabase.from("report_signals").delete().eq("report_id", report.id);

  // Store email before analysis (so we can notify even if it times out)
  if (email) {
    await supabase.from("notification_requests").insert({ report_id: report.id, email });
  }

  // ── Parallel analysis ──────────────────────────────────────────────────────
  // Fire all 3 signal groups simultaneously. Each group saves its results to
  // the DB the moment it completes, so the UI sees progressive updates on polls.
  const allSignals: SignalResult[] = [];

  try {
    await Promise.all(
      SIGNAL_GROUPS.map(group =>
        analyzeSignalGroup(symbol, exchange, companyName, group)
          .then(async (signals) => {
            allSignals.push(...signals);
            await persistSignals(supabase, report.id, signals);
          })
      )
    );
  } catch (err) {
    await supabase.from("reports").update({ status: "failed" }).eq("id", report.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Generate summary after all signals are scored
  const total_score = allSignals.reduce((a, s) => a + s.score, 0);
  const band = getBand(total_score);
  let summary = "";
  try {
    summary = await generateSummary(symbol, exchange, companyName, allSignals, band.label, total_score, MAX_SCORE);
  } catch {
    // Non-fatal — report still complete without summary
  }

  // Finalise the report
  await supabase.from("reports").update({
    status: "complete",
    total_score,
    max_score: MAX_SCORE,
    band: band.label,
    summary,
    analyzed_at: new Date().toISOString(),
  }).eq("id", report.id);

  // Notify subscribers
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://invest-growth.com";
  const reportUrl = `${appUrl}/stock/${exchange}:${symbol}`;

  const { data: pendingNotifs } = await supabase
    .from("notification_requests")
    .select("id, email")
    .eq("report_id", report.id)
    .is("notified_at", null);

  for (const notif of pendingNotifs ?? []) {
    if (!notif.email) continue;
    try {
      await sendReportReadyEmail({ to: notif.email, companyName, symbol, exchange, totalScore: total_score, band: band.label, reportUrl });
      await supabase.from("notification_requests").update({ notified_at: new Date().toISOString() }).eq("id", notif.id);
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ ok: true, report_id: report.id, total_score, band: band.label });
}
