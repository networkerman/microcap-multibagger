// /api/watchlist — authenticated watchlist CRUD.
// All routes require a valid Supabase session (magic link auth).
import { NextResponse } from "next/server";
import { createAuthClient } from "@/lib/supabase/server-auth";
import { createServiceClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// GET /api/watchlist
// Returns the user's saved stocks, enriched with current report data.
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createServiceClient();

  // Get the user's watchlist, then join with current report data.
  const { data: watchlist } = await supabase
    .from("user_watchlist")
    .select("symbol, exchange, saved_at")
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false });

  if (!watchlist || watchlist.length === 0) return NextResponse.json([]);

  // Fetch current report for each saved stock (batch).
  const { data: reports } = await supabase
    .from("reports")
    .select("symbol, exchange, company_name, total_score, max_score, band, status, analyzed_at")
    .in(
      "symbol",
      watchlist.map(w => w.symbol)
    );

  const reportMap = new Map(
    (reports ?? []).map(r => [`${r.exchange}:${r.symbol}`, r])
  );

  const enriched = watchlist.map(w => ({
    ...w,
    ...(reportMap.get(`${w.exchange}:${w.symbol}`) ?? {}),
  }));

  return NextResponse.json(enriched);
}

// POST /api/watchlist  { symbol, exchange }
// Saves a stock to the user's watchlist.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { symbol, exchange } = await req.json() as { symbol: string; exchange: string };
  if (!symbol || !exchange) {
    return NextResponse.json({ error: "symbol and exchange required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Use service role to bypass RLS for the insert (user is verified above).
  const { error } = await supabase
    .from("user_watchlist")
    .upsert({ user_id: user.id, symbol, exchange }, { onConflict: "user_id,symbol,exchange" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// DELETE /api/watchlist  { symbol, exchange }
// Removes a stock from the user's watchlist.
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { symbol, exchange } = await req.json() as { symbol: string; exchange: string };

  const supabase = createServiceClient();

  const { error } = await supabase
    .from("user_watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("symbol", symbol)
    .eq("exchange", exchange);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
