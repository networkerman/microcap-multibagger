import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeStock } from "@/lib/claude";
import { sendReportReadyEmail } from "@/lib/resend";

// POST /api/analyze
// Body: { symbol, exchange, companyName, email? }
// Creates/resets the report row, runs AI analysis, notifies subscribers.
export async function POST(req: Request) {
  const body = await req.json();
  const { symbol, exchange, companyName, email } = body as {
    symbol: string;
    exchange: string;
    companyName: string;
    email?: string;
  };

  if (!symbol || !exchange || !companyName) {
    return NextResponse.json({ error: "symbol, exchange, companyName required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Upsert report row in "analyzing" state
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: report, error: upsertError } = await supabase
    .from("reports")
    .upsert(
      { symbol, exchange, company_name: companyName, status: "analyzing", expires_at: expiresAt },
      { onConflict: "symbol,exchange" }
    )
    .select()
    .single();

  if (upsertError || !report) {
    return NextResponse.json({ error: upsertError?.message ?? "upsert failed" }, { status: 500 });
  }

  // Store email in notification queue before analysis (so failures still notify)
  if (email) {
    await supabase.from("notification_requests").insert({ report_id: report.id, email });
  }

  // Run AI analysis — this is the expensive step
  let result;
  try {
    result = await analyzeStock(symbol, exchange, companyName);
  } catch (err) {
    await supabase
      .from("reports")
      .update({ status: "failed" })
      .eq("id", report.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Persist signal scores
  await supabase.from("report_signals").delete().eq("report_id", report.id);
  await supabase.from("report_signals").insert(
    result.signals.map(s => ({
      report_id: report.id,
      signal_id: s.signal_id,
      label: s.label,
      score: s.score,
      max_score: s.max_score,
      reasoning: s.reasoning,
      sources: s.sources,
    }))
  );

  // Update report with final scores
  await supabase.from("reports").update({
    status: "complete",
    total_score: result.total_score,
    max_score: result.max_score,
    band: result.band,
    summary: result.summary,
    analyzed_at: new Date().toISOString(),
  }).eq("id", report.id);

  // Notify all pending subscribers
  const { data: pendingNotifs } = await supabase
    .from("notification_requests")
    .select("id, email")
    .eq("report_id", report.id)
    .is("notified_at", null);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const reportUrl = `${appUrl}/stock/${exchange}:${symbol}`;

  for (const notif of pendingNotifs ?? []) {
    if (!notif.email) continue;
    try {
      await sendReportReadyEmail({
        to: notif.email,
        companyName,
        symbol,
        exchange,
        totalScore: result.total_score,
        band: result.band,
        reportUrl,
      });
      await supabase
        .from("notification_requests")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", notif.id);
    } catch {
      // Non-fatal — don't fail the whole request if email bounces
    }
  }

  return NextResponse.json({ ok: true, report_id: report.id, ...result });
}
