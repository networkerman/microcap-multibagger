import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// GET /api/report?symbol=UNIVASTU&exchange=NSE
// Returns the cached report if it exists and is not expired (90 days).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.toUpperCase();
  const exchange = searchParams.get("exchange")?.toUpperCase() ?? "NSE";

  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const supabase = createServiceClient();

  const { data: report } = await supabase
    .from("reports")
    .select(`*, report_signals(*)`)
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .single();

  if (!report) return NextResponse.json(null);

  // Expired reports are surfaced but flagged so UI can prompt for refresh
  const expired = report.expires_at && new Date(report.expires_at) < new Date();
  return NextResponse.json({ ...report, expired });
}
