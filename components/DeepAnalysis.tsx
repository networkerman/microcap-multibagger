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

const CATEGORY_META = {
  business:   { accent: "#4ade80", border: "#2d4a3e", bg: "#0a1e18", label: "The Business",    range: "Q1–Q5"  },
  management: { accent: "#a78bfa", border: "#3a2d5c", bg: "#130d2e", label: "The Management",  range: "Q6–Q10" },
  price:      { accent: "#fb923c", border: "#4a2d1a", bg: "#1e0e08", label: "The Price",        range: "Q11–Q15"},
};

export default function DeepAnalysis({ reportId, symbol, exchange, companyName, band }: Props) {
  const [analysis, setAnalysis]   = useState<Analysis | null>(null);
  const [loading, setLoading]     = useState(true);
  const [triggered, setTriggered] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError]         = useState("");
  const [expanded, setExpanded]   = useState<Record<number, boolean>>({});
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const analysisId = useRef<string | null>(null);

  useEffect(() => {
    checkExisting();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [symbol, exchange]);

  async function checkExisting(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const res  = await fetch(`/api/deep-analysis?symbol=${symbol}&exchange=${exchange}`);
      const data = await res.json();
      if (data?.questions?.length > 0) {
        setAnalysis(data);
        setAnalysing(false);
      } else if (analysisId.current) {
        // Placeholder exists but still computing — keep polling
        pollTimer.current = setTimeout(() => checkExisting(true), 4000);
      }
    } catch { /* ignore */ }
    finally { if (!quiet) setLoading(false); }
  }

  async function handleAnalyseFurther() {
    setError("");
    setTriggered(true);
    setAnalysing(true);

    try {
      const res = await fetch("/api/deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId, symbol, exchange, company_name: companyName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to start analysis");

      const { analysis_id, cached } = await res.json();
      analysisId.current = analysis_id;

      if (cached) {
        // Already complete — fetch it
        await checkExisting(true);
        setAnalysing(false);
      } else {
        // Background job running — start polling every 4s
        pollTimer.current = setTimeout(() => checkExisting(true), 4000);
      }
    } catch (e: any) {
      setError(e.message);
      setTriggered(false);
      setAnalysing(false);
    }
  }

  if (loading) return null;

  return (
    <div style={{ marginTop: 32 }}>

      {/* Section divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
        <span style={{ color: "#f59e0b", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>
          15-QUESTION DEEP ANALYSIS · SAFAL NIVESHAK FRAMEWORK
        </span>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
      </div>

      {/* ── Pre-trigger prompt ── */}
      {!triggered && !analysis && (
        <div style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 16, padding: "28px 28px 24px", textAlign: "center" }}>
          <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 10, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>
            AVAILABLE FOR {band} STOCKS ONLY
          </div>
          <h3 style={{ color: "#ffd700", fontWeight: 800, fontSize: 20, margin: "0 0 10px" }}>
            Go deeper — 15 Honest Questions
          </h3>
          <p style={{ color: "#7a9ab5", fontSize: 13, lineHeight: 1.7, maxWidth: 520, margin: "0 auto 8px" }}>
            A deep-thinking AI researches this company across three dimensions: the business,
            the management, and the price you're paying.
          </p>
          <p style={{ color: "#5a7a94", fontSize: 12, lineHeight: 1.6, maxWidth: 500, margin: "0 auto 16px" }}>
            Inspired by Vishal Khandelwal's investor thinking framework from <em>Safal Niveshak</em>.
            Every answer is grounded in company-specific facts — not generic platitudes.
          </p>

          {error && (
            <div style={{ background: "#1f0505", border: "1px solid #ef444455", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 12, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            onClick={handleAnalyseFurther}
            style={{
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              color: "#000", border: "none", borderRadius: 12,
              padding: "14px 36px", fontSize: 14, fontWeight: 800,
              cursor: "pointer", letterSpacing: 0.5,
            }}
          >
            🔍 Analyse Further — Free
          </button>
          <p style={{ color: "#2e4a60", fontSize: 11, marginTop: 10 }}>
            Takes ~60–90 seconds · Results cached for future visitors
          </p>
        </div>
      )}

      {/* ── In-progress state ── */}
      {analysing && !analysis && (
        <div style={{ background: "#0c1d2c", border: "1px solid #22c55e44", borderRadius: 16, padding: "36px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <span className="mmb-live-dot" style={{ width: 12, height: 12 }} />
          </div>
          <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            Analysis in progress…
          </div>
          <div style={{ color: "#5a7a94", fontSize: 13, lineHeight: 1.6 }}>
            Researching all 15 questions from annual reports, BSE/NSE filings, and public data.
            <br />This takes 60–120 seconds. Feel free to wait — the page will update automatically.
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {analysis && analysis.questions.length > 0 && (
        <div>

          {/* Overall verdict */}
          {analysis.overall_verdict && (
            <div style={{ background: "#0a1824", border: "1px solid #f59e0b44", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>
                OVERALL VERDICT
              </div>
              <p style={{ color: "#c8d8e8", fontSize: 14, lineHeight: 1.75, margin: 0 }}>
                {analysis.overall_verdict}
              </p>
            </div>
          )}

          {/* Questions by category */}
          {(["business", "management", "price"] as const).map(cat => {
            const meta = CATEGORY_META[cat];
            const qs   = analysis.questions.filter(q => q.category === cat);
            if (!qs.length) return null;

            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                {/* Category header */}
                <div style={{
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  borderBottom: "none", borderRadius: "12px 12px 0 0",
                  padding: "12px 18px", display: "flex", alignItems: "center", gap: 10,
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.accent, flexShrink: 0 }} />
                  <span style={{ color: meta.accent, fontWeight: 700, fontSize: 12, letterSpacing: 1.5 }}>
                    {meta.label.toUpperCase()}
                  </span>
                  <span style={{ color: "#2e4a60", fontSize: 11 }}>{meta.range}</span>
                </div>

                <div style={{ border: `1px solid ${meta.border}`, borderTop: "none", borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
                  {qs.map((q, i) => {
                    const isOpen = expanded[q.number];
                    const isLast = i === qs.length - 1;
                    return (
                      <div key={q.number} style={{
                        borderBottom: isLast ? "none" : `1px solid ${meta.border}`,
                        background: isOpen ? meta.bg : "#0c1d2c",
                        transition: "background 0.2s",
                      }}>
                        <div
                          onClick={() => setExpanded(p => ({ ...p, [q.number]: !p[q.number] }))}
                          style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 12 }}
                        >
                          <div style={{
                            minWidth: 28, height: 28, borderRadius: 8,
                            background: meta.bg, border: `1px solid ${meta.border}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: meta.accent, fontWeight: 800, fontSize: 12, flexShrink: 0,
                          }}>
                            Q{q.number}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 13, marginBottom: 2, lineHeight: 1.4 }}>
                              {q.question}
                            </div>
                            <div style={{ color: "#2e4a60", fontSize: 10, letterSpacing: 0.5 }}>{q.timeref}</div>
                          </div>
                          <div style={{
                            color: "#1a2e40", fontSize: 14, flexShrink: 0,
                            transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none",
                          }}>▼</div>
                        </div>
                        {isOpen && (
                          <div style={{ padding: "0 18px 16px 58px", borderTop: `1px solid ${meta.border}` }}>
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

          {/* ── Buy Me a Coffee — shown right after results ── */}
          <div style={{
            marginTop: 24,
            background: "linear-gradient(135deg, #0c1d2c, #0a1418)",
            border: "1px solid #f59e0b33",
            borderRadius: 16, padding: "22px 24px",
            display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ color: "#f59e0b", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>
                FOUND THIS USEFUL?
              </div>
              <p style={{ color: "#7a9ab5", fontSize: 13, lineHeight: 1.65, margin: 0 }}>
                This deep analysis is powered by AI and costs real money to run.
                If it helped your research, buying me a coffee keeps this tool free for everyone.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <a
                href="https://rzp.io/rzp/vbTHarl"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#000", borderRadius: 12,
                  padding: "12px 28px", fontWeight: 800,
                  fontSize: 14, textDecoration: "none",
                  letterSpacing: 0.5, whiteSpace: "nowrap",
                }}
              >
                ☕ Buy Me a Coffee · ₹299
              </a>
              <span style={{ color: "#2e4a60", fontSize: 10 }}>UPI · Cards · Net Banking via Razorpay</span>
            </div>
          </div>

          <div style={{ textAlign: "center", color: "#1a2e40", fontSize: 10, marginTop: 12 }}>
            Analysed by AI ·{" "}
            {new Date(analysis.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            {" "}· Not financial advice
          </div>
        </div>
      )}
    </div>
  );
}
