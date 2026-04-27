"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReportView from "@/components/ReportView";
import ContactCapture from "@/components/ContactCapture";

type Status = "loading" | "no-report" | "analyzing" | "has-report";

export default function StockPage() {
  const params = useParams();
  // slug is "EXCHANGE:SYMBOL", e.g. "NSE:UNIVASTU"
  const slug = decodeURIComponent(params.symbol as string);
  const [exchange, symbol] = slug.includes(":") ? slug.split(":") : ["NSE", slug];

  const [status, setStatus] = useState<Status>("loading");
  const [report, setReport] = useState<any>(null);
  const [companyName, setCompanyName] = useState(symbol);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const fetchReport = async () => {
    setStatus("loading");
    const res = await fetch(`/api/report?symbol=${symbol}&exchange=${exchange}`);
    const data = await res.json();
    if (!data) {
      // No report yet — try to get the company name from instruments
      const searchRes = await fetch(`/api/search?q=${symbol}`);
      const instruments = await searchRes.json();
      const match = instruments.find((i: any) => i.symbol === symbol && i.exchange === exchange)
        ?? instruments[0];
      if (match) setCompanyName(match.name);
      setStatus("no-report");
    } else if (data.status === "analyzing") {
      setStatus("analyzing");
      // Poll until done
      setTimeout(fetchReport, 5000);
    } else {
      setReport(data);
      setCompanyName(data.company_name);
      setStatus("has-report");
    }
  };

  useEffect(() => {
    fetchReport();
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
      setStatus("analyzing");
      // Start polling
      setTimeout(fetchReport, 5000);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "#060f18", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "32px 16px", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>

        {/* Back nav */}
        <button
          onClick={() => router.push("/")}
          style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 13, cursor: "pointer", marginBottom: 24, padding: 0, display: "flex", alignItems: "center", gap: 6 }}
        >
          ← Back to search
        </button>

        {status === "loading" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#3d5a73" }}>
            Loading…
          </div>
        )}

        {status === "analyzing" && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ color: "#f59e0b", fontSize: 14, fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>ANALYSING</div>
            <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{companyName}</div>
            <div style={{ color: "#3d5a73", fontSize: 13, marginBottom: 32 }}>Claude is scoring 12 signals using public filings and data sources…</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {["S1","S2","S3","S4","S5","S6","S7","S8","S9","S10","S11","S12"].map(id => (
                <div key={id} style={{ width: 40, height: 40, borderRadius: 8, background: "#0c1d2c", border: "1px solid #1a2e40", display: "flex", alignItems: "center", justifyContent: "center", color: "#3d5a73", fontSize: 11, fontWeight: 700 }}>
                  {id}
                </div>
              ))}
            </div>
            <p style={{ color: "#2e4a60", fontSize: 12, marginTop: 24 }}>We'll email you when it's ready. This page will auto-refresh.</p>
          </div>
        )}

        {status === "no-report" && (
          <div style={{ padding: "40px 0" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 700, marginBottom: 6 }}>{companyName}</div>
              <div style={{ color: "#3d5a73", fontSize: 13 }}>{symbol} · {exchange}</div>
              <p style={{ color: "#5a7a94", fontSize: 14, marginTop: 16 }}>No analysis exists yet for this stock. Run one now.</p>
            </div>
            {error && (
              <div style={{ background: "#1f0505", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13, textAlign: "center", marginBottom: 16 }}>
                {error}
              </div>
            )}
            <ContactCapture
              symbol={symbol}
              exchange={exchange}
              companyName={companyName}
              onSubmit={runAnalysis}
              loading={submitting}
            />
          </div>
        )}

        {status === "has-report" && report && (
          <ReportView
            report={report}
            onRequestRefresh={() => {
              setStatus("no-report");
              setReport(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
