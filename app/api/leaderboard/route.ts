// GET /api/leaderboard
// Returns the top 3 completed analyses from the last 30 days.
// Public — no auth required.
//
// TODO: When budget allows, add a re-scoring cron job that refreshes analyses
// older than N days so great stocks don't fall off the leaderboard automatically.
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Cache for 5 minutes on Vercel's edge cache — leaderboard doesn't need to be real-time.
export const revalidate = 300;

export async function GET() {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("reports")
    .select("symbol, exchange, company_name, total_score, max_score, band, analyzed_at")
    .eq("status", "complete")
    .not("total_score", "is", null)
    .gte("analyzed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("total_score", { ascending: false })
    .order("analyzed_at", { ascending: false })
    .limit(3);

  if (error) return NextResponse.json([], { status: 200 }); // degrade gracefully

  return NextResponse.json(data ?? []);
}
