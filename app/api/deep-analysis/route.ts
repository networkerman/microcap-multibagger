import { NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { runDeepAnalysis } from "@/lib/deepseek";
import { fetchScreenerData, formatScreenerContext } from "@/lib/screener";

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

// POST — trigger deep analysis (requires verified payment)
export async function POST(req: Request) {
  const { report_id, symbol, exchange, company_name, payment_id } = await req.json() as {
    report_id: string;
    symbol: string;
    exchange: string;
    company_name: string;
    payment_id: string;
  };

  if (!report_id || !symbol || !exchange || !payment_id) {
    return NextResponse.json({ error: "report_id, symbol, exchange, payment_id required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify the payment exists and is in 'paid' status
  const { data: payment } = await supabase
    .from("payments")
    .select("id, status")
    .eq("razorpay_payment_id", payment_id)
    .single();

  if (!payment || payment.status !== "paid") {
    return NextResponse.json({ error: "Payment not verified" }, { status: 402 });
  }

  // Check if analysis already exists for this payment
  const { data: existing } = await supabase
    .from("deep_analyses")
    .select("id")
    .eq("payment_id", payment_id)
    .single();

  if (existing) {
    // Already ran — return the id so client can fetch it
    return NextResponse.json({ ok: true, analysis_id: existing.id, cached: true });
  }

  // Insert a placeholder row so client can poll
  const { data: placeholder } = await supabase
    .from("deep_analyses")
    .insert({
      report_id,
      symbol,
      exchange,
      company_name,
      questions: [],
      overall_verdict: null,
      payment_id,
    })
    .select("id")
    .single();

  if (!placeholder) {
    return NextResponse.json({ error: "Failed to create analysis record" }, { status: 500 });
  }

  const analysisId = placeholder.id;

  // Run analysis in background — DeepSeek reasoner takes ~30-90s
  after(async () => {
    try {
      const screenerData = await fetchScreenerData(symbol, exchange);
      const context = screenerData ? formatScreenerContext(screenerData) : "";

      const result = await runDeepAnalysis(symbol, exchange, company_name, context);

      await supabase.from("deep_analyses").update({
        questions: result.questions,
        overall_verdict: result.overall_verdict,
      }).eq("id", analysisId);
    } catch (err) {
      console.error("Deep analysis failed:", err);
      // Leave the placeholder row — client will see empty questions and can retry
    }
  });

  return NextResponse.json({ ok: true, analysis_id: analysisId, cached: false }, { status: 202 });
}
