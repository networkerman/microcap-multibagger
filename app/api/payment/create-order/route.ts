import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { createServiceClient } from "@/lib/supabase/server";

const AMOUNT_PAISE = 29900; // ₹299

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}

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

  try {
    const rzp = getRazorpay();

    const order = await rzp.orders.create({
      amount: AMOUNT_PAISE,
      currency: "INR",
      receipt: `da_${report_id.slice(0, 8)}`,
      notes: {
        purpose: "deep_analysis",
        symbol,
        exchange,
        company_name: company_name ?? symbol,
        report_id,
      },
    });

    // Log payment intent
    const supabase = createServiceClient();
    await supabase.from("payments").insert({
      razorpay_order_id: order.id,
      amount_paise: AMOUNT_PAISE,
      currency: "INR",
      purpose: "deep_analysis",
      report_id,
      status: "created",
    });

    return NextResponse.json({
      order_id: order.id,
      amount: AMOUNT_PAISE,
      currency: "INR",
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: any) {
    console.error("Razorpay create-order error:", err);
    return NextResponse.json({ error: err.message ?? "Order creation failed" }, { status: 500 });
  }
}
