import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Returns up to 20 matching instruments for the autocomplete.
// Uses Postgres full-text search on name + exact prefix match on symbol.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) return NextResponse.json([]);

  const supabase = createServiceClient();

  // Try symbol prefix first (fast), then fall back to name search
  const { data, error } = await supabase
    .from("instruments")
    .select("symbol, name, exchange, instrument_token")
    .or(`symbol.ilike.${q}%,name.ilike.%${q}%`)
    .order("exchange", { ascending: true })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate: prefer NSE over BSE for same company
  const seen = new Map<string, typeof data[0]>();
  for (const row of data ?? []) {
    const key = row.name.toLowerCase();
    if (!seen.has(key) || row.exchange === "NSE") seen.set(key, row);
  }

  return NextResponse.json(Array.from(seen.values()).slice(0, 10));
}
