import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDeepAnalysis } from "@/lib/deepseek";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";
import { fetchDeepAnalysisContext } from "@/lib/search";

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
    .single();

  return NextResponse.json(data ?? null);
}

// POST — trigger deep analysis (free, no payment required)
export async function POST(req: Request) {
  const { report_id, symbol, exchange, company_name } = await req.json() as {
    report_id: string;
    symbol: string;
    exchange: string;
    company_name: string;
  };

  if (!report_id || !symbol || !exchange) {
    return NextResponse.json({ error: "report_id, symbol, exchange required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Return cached result if one already exists
  const { data: existing } = await supabase
    .from("deep_analyses")
    .select("id, questions")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing && (existing.questions as any[])?.length > 0) {
    return NextResponse.json({ ok: true, analysis_id: existing.id, cached: true });
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

  // Run DeepSeek analysis in background (~60-120s)
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

      console.log(`[deep-analysis:deepseek] Calling DeepSeek for 15-question analysis`);
      const t2 = Date.now();
      const result = await runDeepAnalysis(symbol, exchange, company_name, context);
      console.log(`[deep-analysis:deepseek] Done in ${((Date.now() - t2) / 1000).toFixed(1)}s | questions=${result.questions.length}`);

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
