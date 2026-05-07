"use client";

import { useEffect, useRef, useState } from "react";

interface Question {
  category: "business" | "management" | "price";
  number: number;
  question: string;
  timeref: string;
  answer: string;
}

interface Analysis {
  id: string;
  questions: Question[];
  overall_verdict: string;
  created_at: string;
}

interface Props {
  reportId: string;
  symbol: string;
  exchange: string;
  companyName: string;
  band: string;
}

const CATEGORY_COLORS = {
  business: { border: "#2d4a3e", bg: "#0a1e18", accent: "#4ade80", label: "The Business" },
  management: { border: "#3a2d5c", bg: "#130d2e", accent: "#a78bfa", label: "The Management" },
  price: { border: "#4a2d1a", bg: "#1e0e08", accent: "#fb923c", label: "The Price" },
};

declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (window.Razorpay) { resolve(true); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function DeepAnalysis({ reportId, symbol, exchange, companyName, band }: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const analysisId = useRef<string | null>(null);

  // Fetch existing analysis on mount
  useEffect(() => {
    fetchAnalysis();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [symbol, exchange]);

  async function fetchAnalysis(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/deep-analysis?symbol=${symbol}&exchange=${exchange}`);
      const data = await res.json();
      if (data && data.questions?.length > 0) {
        setAnalysis(data);
        setAnalysing(false);
      } else if (data && analysisId.current) {
        // Placeholder exists but analysis still running — keep polling
        pollTimer.current = setTimeout(() => fetchAnalysis(true), 4000);
      }
    } catch { /* ignore */ }
    finally { if (!quiet) setLoading(false); }
  }

  async function handleAnalyseFurther() {
    setError("");
    setPaying(true);

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      setError("Could not load Razorpay. Please check your internet connection.");
      setPaying(false);
      return;
    }

    // Create Razorpay order
    let orderData: { order_id: string; amount: number; currency: string; key_id: string };
    try {
      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, symbol, exchange, company_name: companyName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Order failed");
      orderData = await res.json();
    } catch (e: any) {
      setError(e.message);
      setPaying(false);
      return;
    }

    // Open Razorpay checkout
    const rzp = new window.Razorpay({
      key: orderData.key_id,
      order_id: orderData.order_id,
      amount: orderData.amount,
      currency: orderData.currency,
      name: "Microcap Multibagger",
      description: `15-Question Deep Analysis · ${companyName}`,
      image: "",
      prefill: {},
      theme: { color: "#f59e0b" },
      modal: {
        ondismiss: () => setPaying(false),
      },
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        try {
          // Verify payment
          const verifyRes = await fetch("/api/payment/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              report_id: reportId,
            }),
          });
          if (!verifyRes.ok) throw new Error("Payment verification failed");

          const { payment_id } = await verifyRes.json();

          // Trigger deep analysis
          setPaying(false);
          setAnalysing(true);

          const daRes = await fetch("/api/deep-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ report_id: reportId, symbol, exchange, company_name: companyName, payment_id }),
          });
          if (!daRes.ok) throw new Error("Failed to start analysis");

          const { analysis_id } = await daRes.json();
          analysisId.current = analysis_id;

          // Start polling
          pollTimer.current = setTimeout(() => fetchAnalysis(true), 5000);
        } catch (e: any) {
          setError(e.message);
          setPaying(false);
          setAnalysing(false);
        }
      },
    });

    rzp.open();
  }

  const categories: Array<"business" | "management" | "price"> = ["business", "management", "price"];
  const categoryLabels: Record<string, string> = { business: "The Business", management: "The Management", price: "The Price" };

  if (loading) return null;

  return (
    <div style={{ marginTop: 32 }}>
      {/* Section header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
        <span style={{ color: "#f59e0b", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>
          15-QUESTION DEEP ANALYSIS · SAFAL NIVESHAK FRAMEWORK
        </span>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
      </div>

      {!analysis && !analysing && (
        <div style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 16, padding: "28px 28px 24px", textAlign: "center" }}>
          {/* Badge */}
          <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 10, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>
            AVAILABLE FOR {band} STOCKS ONLY
          </div>

          <h3 style={{ color: "#ffd700", fontWeight: 800, fontSize: 20, margin: "0 0 10px" }}>
            Analyse Further — 15 Honest Questions
          </h3>
          <p style={{ color: "#7a9ab5", fontSize: 13, lineHeight: 1.7, maxWidth: 520, margin: "0 auto 8px" }}>
            A deep-dive powered by <strong style={{ color: "#c8d8e8" }}>DeepSeek Reasoner (v4)</strong> — one of the world&apos;s most capable reasoning models.
            It researches this company from first principles across three dimensions: the business, the management, and the price you&apos;re paying.
          </p>
          <p style={{ color: "#5a7a94", fontSize: 12, lineHeight: 1.6, maxWidth: 500, margin: "0 auto 6px" }}>
            Inspired by Vishal Khandelwal&apos;s investor thinking framework from <em>Safal Niveshak</em>.
            Each question is answered with company-specific facts from BSE/NSE filings, annual reports, and public data.
          </p>

          {/* Token cost note */}
          <div style={{ background: "#0a1824", border: "1px solid #1a2e40", borderRadius: 10, padding: "10px 16px", margin: "16px auto", maxWidth: 440 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
              <span style={{ color: "#3d5a73", fontSize: 11, lineHeight: 1.6 }}>
                ⚡ Each deep analysis uses ~50,000–80,000 reasoning tokens · API cost ₹70–80 per run ·
                Your ₹299 supports this research tool and keeps it running
              </span>
            </div>
          </div>

          {error && (
            <div style={{ background: "#1f0505", border: "1px solid #ef444455", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 12, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleAnalyseFurther}
            disabled={paying}
            style={{
              background: paying ? "#1a2e40" : "linear-gradient(135deg, #f59e0b, #d97706)",
              color: paying ? "#5a7a94" : "#000",
              border: "none", borderRadius: 12, padding: "14px 32px",
              fontSize: 14, fontWeight: 800, cursor: paying ? "not-allowed" : "pointer",
              letterSpacing: 0.5, marginTop: 4,
            }}
          >
            {paying ? "Opening payment…" : "🔍 Analyse Further · ₹299"}
          </button>

          <p style={{ color: "#2e4a60", fontSize: 11, marginTop: 10 }}>
            Secure payment via Razorpay · UPI, Cards, Net Banking accepted
          </p>
        </div>
      )}

      {analysing && (
        <div style={{ background: "#0c1d2c", border: "1px solid #22c55e44", borderRadius: 16, padding: "32px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="mmb-live-dot" style={{ width: 12, height: 12 }} />
          </div>
          <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>DeepSeek Reasoner is thinking…</div>
          <div style={{ color: "#5a7a94", fontSize: 13 }}>
            Researching 15 questions from annual reports, BSE filings, and public data.
            This takes 60–120 seconds. You can leave and come back — the analysis will be saved.
          </div>
        </div>
      )}

      {analysis && analysis.questions.length > 0 && (
        <div>
          {/* Overall verdict */}
          {analysis.overall_verdict && (
            <div style={{ background: "#0a1824", border: "1px solid #f59e0b44", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>OVERALL VERDICT · DEEPSEEK REASONER</div>
              <p style={{ color: "#c8d8e8", fontSize: 14, lineHeight: 1.75, margin: 0 }}>{analysis.overall_verdict}</p>
            </div>
          )}

          {/* Questions by category */}
          {categories.map(cat => {
            const color = CATEGORY_COLORS[cat];
            const qs = analysis.questions.filter(q => q.category === cat);
            if (qs.length === 0) return null;

            return (
              <div key={cat} style={{ marginBottom: 24 }}>
                {/* Category header */}
                <div style={{
                  background: color.bg, border: `1px solid ${color.border}`,
                  borderBottom: "none", borderRadius: "12px 12px 0 0",
                  padding: "12px 18px",
                  display: "flex", alignItems: "center", gap: 10,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: color.accent, flexShrink: 0 }} />
                  <span style={{ color: color.accent, fontWeight: 700, fontSize: 12, letterSpacing: 1.5 }}>
                    {categoryLabels[cat].toUpperCase()}
                  </span>
                  <span style={{ color: "#2e4a60", fontSize: 11 }}>Questions {qs[0].number}–{qs[qs.length - 1].number}</span>
                </div>

                <div style={{ border: `1px solid ${color.border}`, borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                  {qs.map((q, i) => {
                    const isOpen = expanded[q.number];
                    const isLast = i === qs.length - 1;
                    return (
                      <div
                        key={q.number}
                        style={{
                          borderBottom: isLast ? "none" : `1px solid ${color.border}`,
                          background: isOpen ? color.bg : "#0c1d2c",
                          transition: "background 0.2s",
                        }}
                      >
                        <div
                          onClick={() => setExpanded(p => ({ ...p, [q.number]: !p[q.number] }))}
                          style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12 }}
                        >
                          <div style={{
                            minWidth: 28, height: 28, borderRadius: 8,
                            background: color.bg, border: `1px solid ${color.border}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: color.accent, fontWeight: 800, fontSize: 12, flexShrink: 0,
                          }}>
                            Q{q.number}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 13, marginBottom: 2, lineHeight: 1.4 }}>{q.question}</div>
                            <div style={{ color: "#2e4a60", fontSize: 10, letterSpacing: 0.5 }}>{q.timeref}</div>
                          </div>
                          <div style={{ color: "#1a2e40", fontSize: 14, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>▼</div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "0 18px 16px 58px", borderTop: `1px solid ${color.border}` }}>
                            <p style={{ color: "#7a9ab5", fontSize: 13, lineHeight: 1.8, margin: "12px 0 0" }}>
                              {q.answer}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div style={{ textAlign: "center", color: "#1a2e40", fontSize: 10, marginTop: 4 }}>
            Analysed by DeepSeek Reasoner · {new Date(analysis.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · Not financial advice
          </div>
        </div>
      )}
    </div>
  );
}
