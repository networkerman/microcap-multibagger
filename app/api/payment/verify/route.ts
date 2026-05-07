import { NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, report_id } = await req.json() as {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
    report_id: string;
  };

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }

  // Verify HMAC-SHA256 signature
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(body)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
  }

  // Mark payment as paid in DB
  const supabase = createServiceClient();
  await supabase.from("payments")
    .update({
      razorpay_payment_id,
      razorpay_signature,
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("razorpay_order_id", razorpay_order_id);

  return NextResponse.json({ ok: true, payment_id: razorpay_payment_id });
}
