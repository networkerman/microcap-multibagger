"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReportView from "@/components/ReportView";
import ContactCapture from "@/components/ContactCapture";
import { MAX_SCORE } from "@/lib/signals";

type Status = "loading" | "no-report" | "analyzing" | "has-report";

// Skeleton report shown immediately when analysis starts (before first poll returns)
function makeSkeletonReport(symbol: string, exchange: string, companyName: string) {
  return {
    id: "", symbol, exchange, company_name: companyName,
    status: "analyzing", total_score: 0, max_score: MAX_SCORE,
    band: "", summary: "", analyzed_at: "", expires_at: "",
    expired: false, report_signals: [] as any[],
  };
}

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
      setReport(data);
      setCompanyName(data.company_name ?? companyName);
      setStatus("analyzing");
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
      // 202 returned immediately — show skeleton and start polling
      setShowRefreshOverlay(false);
      setSubmitting(false);
      setReport(null); // will show skeleton
      setStatus("analyzing");
      pollTimer.current = setTimeout(() => fetchReport(true), 2000);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  // Report to pass to ReportView during analysis — skeleton if no data yet
  const liveReport = status === "analyzing"
    ? (report ?? makeSkeletonReport(symbol, exchange, companyName))
    : report;

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

        {/* Analyzing: show live ReportView — signals appear as Claude finishes each group */}
        {status === "analyzing" && liveReport && (
          <ReportView report={liveReport} />
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
