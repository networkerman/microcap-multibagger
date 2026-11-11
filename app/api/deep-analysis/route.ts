import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDeepAnalysis } from "@/lib/claude";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";
import { fetchDeepAnalysisContext } from "@/lib/search";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Deep analyses per IP per hour. Each one is a long, expensive model call.
const RATE_LIMIT = parseInt(process.env.DEEP_ANALYSIS_RATE_LIMIT_HOURLY ?? "3");
// A placeholder younger than this is a run still in progress, not a failure.
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

export const maxDuration = 300;

// GET — fetch existing deep analysis for a symbol
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const exchange = searchParams.get("exchange");

  if (!symbol || !exchange) {
    return NextResponse.json({ error: "symbol and exchange required" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("deep_analyses")
    .select("*")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(data ?? null);
}

// POST — trigger deep analysis (free, no payment required)
export async function POST(req: Request) {
  const { report_id } = await req.json() as { report_id?: string };

  if (!report_id) {
    return NextResponse.json({ error: "report_id required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // The report is the source of truth for what gets analysed: symbol, exchange
  // and company name come from it, never from the request body.
  const { data: report } = await supabase
    .from("reports")
    .select("id, symbol, exchange, company_name, status")
    .eq("id", report_id)
    .maybeSingle();

  if (!report || report.status !== "complete") {
    return NextResponse.json({ error: "No completed report to analyse" }, { status: 404 });
  }
  const { symbol, exchange, company_name } = report;

  // Return the existing analysis if it is finished, or still being produced.
  const { data: existing } = await supabase
    .from("deep_analyses")
    .select("id, questions, created_at")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const finished = Array.isArray(existing?.questions) && existing.questions.length > 0;
  const running = !!existing && !finished && Date.now() - new Date(existing.created_at).getTime() < RUN_TIMEOUT_MS;
  if (existing && (finished || running)) {
    return NextResponse.json({ ok: true, analysis_id: existing.id, cached: true });
  }

  if (!(await checkRateLimit(supabase, clientIp(req), "deep-analysis", RATE_LIMIT))) {
    return NextResponse.json(
      { error: `Rate limit reached. Max ${RATE_LIMIT} deep analyses per hour per IP.` },
      { status: 429 }
    );
  }

  // Insert placeholder row so client can poll
  const { data: placeholder } = await supabase
    .from("deep_analyses")
    .insert({
      report_id,
      symbol,
      exchange,
      company_name,
      questions: [],
      overall_verdict: null,
    })
    .select("id")
    .single();

  if (!placeholder) {
    return NextResponse.json({ error: "Failed to create analysis record" }, { status: 500 });
  }

  const analysisId = placeholder.id;

  // Run the 15-question analysis in the background (it can take several minutes)
  after(async () => {
    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    console.log(`[deep-analysis:start] ${exchange}:${symbol} — "${company_name}" | analysisId=${analysisId}`);
    try {
      console.log(`[deep-analysis:fetch] Starting Screener.in + web context in parallel`);
      const t1 = Date.now();
      const [screenerData, webContext] = await Promise.all([
        fetchScreenerData(symbol, exchange),
        fetchDeepAnalysisContext(company_name),
      ]);
      console.log(`[deep-analysis:fetch] Done in ${((Date.now() - t1) / 1000).toFixed(1)}s | screener=${screenerData ? "ok" : "null"} | webContext=${webContext.length} chars`);

      const context = (screenerData ? formatScreenerContext(screenerData) : "") + webContext;
      console.log(`[deep-analysis:context] Total context: ${context.length} chars`);

      console.log(`[deep-analysis:model] Starting 15-question analysis`);
      const t2 = Date.now();
      const result = await runDeepAnalysis(symbol, exchange, company_name, context);
      console.log(`[deep-analysis:model] Done in ${((Date.now() - t2) / 1000).toFixed(1)}s | questions=${result.questions.length}`);

      await supabase.from("deep_analyses").update({
        questions: result.questions,
        overall_verdict: result.overall_verdict,
      }).eq("id", analysisId);

      console.log(`[deep-analysis:done] ${exchange}:${symbol} completed in ${elapsed()}`);
    } catch (err) {
      console.error(`[deep-analysis:failed] ${exchange}:${symbol} after ${elapsed()}:`, err);
    }
  });

  return NextResponse.json({ ok: true, analysis_id: analysisId, cached: false }, { status: 202 });
}
