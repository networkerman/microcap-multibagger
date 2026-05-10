import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDeepAnalysis } from "@/lib/deepseek";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";
import { fetchDeepAnalysisContext } from "@/lib/search";

export const maxDuration = 120; // DeepSeek reasoner can take longer

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
    try {
      const [screenerData, webContext] = await Promise.all([
        fetchScreenerData(symbol, exchange),
        fetchDeepAnalysisContext(company_name),
      ]);
      const context = (screenerData ? formatScreenerContext(screenerData) : "") + webContext;
      const result = await runDeepAnalysis(symbol, exchange, company_name, context);

      await supabase.from("deep_analyses").update({
        questions: result.questions,
        overall_verdict: result.overall_verdict,
      }).eq("id", analysisId);
    } catch (err) {
      console.error("Deep analysis failed:", err);
    }
  });

  return NextResponse.json({ ok: true, analysis_id: analysisId, cached: false }, { status: 202 });
}
