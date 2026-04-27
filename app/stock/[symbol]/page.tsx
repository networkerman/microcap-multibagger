"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReportView from "@/components/ReportView";
import ContactCapture from "@/components/ContactCapture";

type Status = "loading" | "no-report" | "analyzing" | "has-report";

export default function StockPage() {
  const params = useParams();
  const slug = decodeURIComponent(params.symbol as string);
  const [exchange, symbol] = slug.includes(":") ? slug.split(":") : ["NSE", slug];

  const [status, setStatus] = useState<Status>("loading");
  const [report, setReport] = useState<any>(null);
  const [companyName, setCompanyName] = useState(symbol);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showRefreshOverlay, setShowRefreshOverlay] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const router = useRouter();

  const fetchReport = async (quiet = false) => {
    if (!quiet) setStatus("loading");
    const res = await fetch(`/api/report?symbol=${symbol}&exchange=${exchange}`);
    const data = await res.json();

    if (!data) {
      if (!quiet) {
        const searchRes = await fetch(`/api/search?q=${symbol}`);
        const instruments = await searchRes.json();
        const match = instruments.find((i: any) => i.symbol === symbol && i.exchange === exchange) ?? instruments[0];
        if (match) setCompanyName(match.name);
      }
      setStatus("no-report");
    } else if (data.status === "analyzing") {
      // Show partial signals immediately (some groups may already be done)
      setReport(data);
      setCompanyName(data.company_name ?? companyName);
      setStatus("analyzing");
      // Poll every 2s while analyzing
      pollTimer.current = setTimeout(() => fetchReport(true), 2000);
    } else {
      setReport(data);
      setCompanyName(data.company_name);
      setStatus("has-report");
      setShowRefreshOverlay(false);
    }
  };

  useEffect(() => {
    fetchReport();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [symbol, exchange]);

  const runAnalysis = async (email: string) => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, exchange, companyName, email }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Analysis failed");
      }
      setShowRefreshOverlay(false);
      setStatus("analyzing");
      pollTimer.current = setTimeout(() => fetchReport(true), 2000);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  // Primary signal IDs for the animated loading indicator
  const PRIMARY = ["S3", "S4", "S10"];
  const ALL_SIGNALS = ["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"];
  const scoredIds = new Set((report?.report_signals ?? []).map((s: any) => s.signal_id));

  return (
    <div style={{ background: "#060f18", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "32px 16px", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>

        <button
          onClick={() => router.push("/")}
          style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 13, cursor: "pointer", marginBottom: 24, padding: 0 }}
        >
          ← Back to search
        </button>

        {status === "loading" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#3d5a73" }}>Loading…</div>
        )}

        {/* ── Analyzing state: shows partial report as signals come in ── */}
        {status === "analyzing" && (
          <>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>
                ANALYSIS IN PROGRESS
              </div>
              <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{companyName}</div>
              <div style={{ color: "#3d5a73", fontSize: 13, marginBottom: 20 }}>
                Claude is researching and scoring signals — results appear as each group completes
              </div>

              {/* Signal progress tiles */}
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
                {ALL_SIGNALS.map(id => {
                  const done = scoredIds.has(id);
                  const isPrimary = PRIMARY.includes(id);
                  return (
                    <div key={id} style={{
                      width: 44, height: 44, borderRadius: 9,
                      background: done ? (isPrimary ? "#0f1f35" : "#0c1d2c") : "#060f18",
                      border: `1.5px solid ${done ? (isPrimary ? "#f59e0b" : "#22c55e") : "#1a2e40"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: done ? (isPrimary ? "#f59e0b" : "#22c55e") : "#2e4a60",
                      fontSize: 11, fontWeight: 800,
                      transition: "all 0.4s ease",
                    }}>
                      {done ? "✓" : id}
                    </div>
                  );
                })}
              </div>

              <div style={{ color: "#2e4a60", fontSize: 12 }}>
                {scoredIds.size}/12 signals scored · We'll email you when complete
              </div>
            </div>

            {/* Show partial report below the progress indicator */}
            {report && (report.report_signals ?? []).length > 0 && (
              <ReportView report={{ ...report, status: "analyzing" }} />
            )}
          </>
        )}

        {status === "no-report" && (
          <div style={{ padding: "40px 0" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{companyName}</div>
              <div style={{ color: "#3d5a73", fontSize: 13 }}>{symbol} · {exchange}</div>
              <p style={{ color: "#5a7a94", fontSize: 14, marginTop: 16 }}>No analysis exists for this stock yet. Run one now.</p>
            </div>
            {error && (
              <div style={{ background: "#1f0505", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 16 }}>
                {error}
              </div>
            )}
            <ContactCapture
              symbol={symbol} exchange={exchange} companyName={companyName}
              onSubmit={runAnalysis} loading={submitting}
            />
          </div>
        )}

        {status === "has-report" && report && (
          <>
            {showRefreshOverlay && (
              <div style={{
                position: "fixed", inset: 0, background: "rgba(6,15,24,0.92)", zIndex: 100,
                display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
              }}>
                <div style={{ width: "100%", maxWidth: 460 }}>
                  <button
                    onClick={() => { setShowRefreshOverlay(false); setError(""); }}
                    style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 13, cursor: "pointer", marginBottom: 16, padding: 0 }}
                  >
                    ← Back to report
                  </button>
                  {error && (
                    <div style={{ background: "#1f0505", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 16 }}>
                      {error}
                    </div>
                  )}
                  <ContactCapture
                    symbol={symbol} exchange={exchange} companyName={companyName}
                    onSubmit={runAnalysis} loading={submitting}
                  />
                </div>
              </div>
            )}
            <ReportView
              report={report}
              onRequestRefresh={() => { setShowRefreshOverlay(true); setError(""); setSubmitting(false); }}
            />
          </>
        )}
      </div>
    </div>
  );
}
