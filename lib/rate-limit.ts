import type { createServiceClient } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServiceClient>;

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Client IP as reported by the hosting platform's proxy. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Allows up to `limit` calls per IP per hour for one endpoint, and records this
 * call when allowed. Every model-backed endpoint must go through this: each
 * call spends real money on the analysis model.
 */
export async function checkRateLimit(
  supabase: Supabase,
  ip: string,
  endpoint: string,
  limit: number,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count } = await supabase
    .from("rate_limit_log")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("endpoint", endpoint)
    .gte("created_at", windowStart);

  if ((count ?? 0) >= limit) return false;

  // Awaited so a burst of parallel requests can't all slip under the limit unrecorded.
  await supabase.from("rate_limit_log").insert({ ip, endpoint });
  return true;
}

/**
 * Looks up a listed instrument. Model-backed endpoints only accept symbols we
 * know, and take the company name from our table rather than from the caller,
 * so request bodies can't inject arbitrary text into the model prompt.
 */
export async function findInstrument(
  supabase: Supabase,
  symbol: string,
  exchange: string,
): Promise<{ symbol: string; exchange: string; name: string } | null> {
  const { data } = await supabase
    .from("instruments")
    .select("symbol, exchange, name")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .maybeSingle();
  return data ?? null;
}
