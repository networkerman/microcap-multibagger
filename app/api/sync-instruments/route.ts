import { NextResponse } from "next/server";
import { fetchEquityInstruments } from "@/lib/kite";
import { createServiceClient } from "@/lib/supabase/server";

// Syncs NSE + BSE EQ instruments from Kite into Supabase.
// Called once on deploy and then daily via a cron or Vercel cron job.
// Protected by a secret token to prevent public triggering.
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.SYNC_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const instruments = await fetchEquityInstruments();

  const supabase = createServiceClient();

  // Upsert in batches of 500 to stay within Supabase limits
  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < instruments.length; i += BATCH) {
    const batch = instruments.slice(i, i + BATCH).map(inst => ({
      symbol: inst.symbol,
      name: inst.name,
      exchange: inst.exchange,
      instrument_token: inst.instrument_token,
      exchange_token: inst.exchange_token,
      segment: inst.segment,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("instruments")
      .upsert(batch, { onConflict: "symbol,exchange" });

    if (error) throw new Error(error.message);
    upserted += batch.length;
  }

  return NextResponse.json({ ok: true, upserted });
}
