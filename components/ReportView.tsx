"use client";

import { useState } from "react";
import { SIGNALS, getBand } from "@/lib/signals";

interface SignalResult {
  signal_id: string;
  label: string;
  score: number;
  max_score: number;
  reasoning: string;
  sources: string[];
}

interface Report {
  id: string;
  symbol: string;
  exchange: string;
  company_name: string;
  status: string;
  total_score: number;
  max_score: number;
  band: string;
  summary: string;
  analyzed_at: string;
  expires_at: string;
  expired?: boolean;
  report_signals: SignalResult[];
}

interface Props {
  report: Report;
  onRequestRefresh?: () => void;
}

function pctColor(v: number, m: number): string {
  if (m === 0) return "#374151";
  const r = v / m;
  return r >= 0.85 ? "#22c55e" : r >= 0.5 ? "#f59e0b" : r > 0 ? "#f97316" : "#374151";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (hours < 1) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const BAND_COLORS: Record<string, string> = {
  "STRONG BUY": "#22c55e", "WATCHLIST": "#f59e0b",
  "INVESTIGATE": "#f97316", "AVOID": "#ef4444",
};
const BAND_BG: Record<string, string> = {
  "STRONG BUY": "#022c11", "WATCHLIST": "#1c1005",
  "INVESTIGATE": "#1c0e05", "AVOID": "#1f0505",
};

export default function ReportView({ report, onRequestRefresh }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  const isAnalyzing = report.status === "analyzing";
  const band = report.band ?? "INVESTIGATE";
  const color = BAND_COLORS[band] ?? "#94a3b8";
  const bg = BAND_BG[band] ?? "#0c1d2c";
  const total = report.total_score;
  const max = report.max_score ?? 42;
  const analyzedAgo = timeAgo(report.analyzed_at);
  const isStale = report.expired;

  const signalMap = new Map(report.report_signals.map(s => [s.signal_id, s]));

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>
          MICROCAP MULTIBAGGER · FRAMEWORK v2.0
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 900, color: "#ffd700" }}>
          {report.company_name}
        </h1>
        <div style={{ color: "#3d5a73", fontSize: 13, marginBottom: 14 }}>
          {report.symbol} · {report.exchange}
        </div>

        {/* Action bar: timestamp + share + refresh */}
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Timestamp pill */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: isStale ? "#f59e0b18" : "#0c1d2c",
            border: `1px solid ${isStale ? "#f59e0b55" : "#1a2e40"}`,
            borderRadius: 20, padding: "5px 14px",
            color: isStale ? "#f59e0b" : "#5a7a94", fontSize: 12,
          }}>
            {isStale ? "⚠ " : "🕐 "}Analysed {analyzedAgo}
            {isStale && <span style={{ color: "#f59e0b80" }}> · over 90 days old</span>}
          </div>

          {/* Share button */}
          <button
            onClick={copyLink}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: copied ? "#22c55e22" : "#0c1d2c",
              border: `1px solid ${copied ? "#22c55e55" : "#1a2e40"}`,
              borderRadius: 20, padding: "5px 14px",
              color: copied ? "#22c55e" : "#38bdf8",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {copied ? "✓ Link copied!" : "⬆ Share report"}
          </button>

          {/* Refresh button — always visible */}
          {onRequestRefresh && (
            <button
              onClick={onRequestRefresh}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#0c1d2c", border: "1px solid #1a2e40",
                borderRadius: 20, padding: "5px 14px",
                color: "#5a7a94", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              ↺ Refresh analysis
            </button>
          )}
        </div>
      </div>

      {/* Score banner */}
      <div style={{ background: bg, border: `1px solid ${color}55`, borderRadius: 16, padding: "20px 24px", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 58, fontWeight: 900, color, lineHeight: 1 }}>{total}</span>
              <span style={{ fontSize: 20, color: "#2e4a60", fontWeight: 700 }}>/ {max}</span>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "inline-block", border: `2px solid ${color}`, borderRadius: 12, padding: "12px 28px", marginBottom: 8 }}>
              <div style={{ color, fontWeight: 900, fontSize: 20, letterSpacing: 1.5 }}>{band}</div>
            </div>
            <div style={{ color: "#3d5a73", fontSize: 12, maxWidth: 210 }}>
              {getBand(total).desc}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 18, height: 7, background: "#0c1d2c", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(total / max) * 100}%`, background: color, borderRadius: 4 }} />
        </div>

        {/* Band chips */}
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {[
            { r: "≥30", l: "STRONG BUY", c: "#22c55e", a: total >= 30 },
            { r: "21–29", l: "WATCHLIST", c: "#f59e0b", a: total >= 21 && total < 30 },
            { r: "14–20", l: "INVESTIGATE", c: "#f97316", a: total >= 14 && total < 21 },
            { r: "<14", l: "AVOID", c: "#ef4444", a: total < 14 },
          ].map(b => (
            <div key={b.l} style={{ padding: "3px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: b.a ? b.c + "28" : "#0c1d2c", color: b.a ? b.c : "#2e4a60", border: `1px solid ${b.a ? b.c : "#1a2e40"}` }}>
              {b.r} · {b.l}
            </div>
          ))}
        </div>
      </div>

      {/* AI Summary */}
      {report.summary && (
        <div style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
          <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>AI INVESTMENT THESIS</div>
          <p style={{ color: "#7a9ab5", fontSize: 14, lineHeight: 1.75, margin: 0 }}>{report.summary}</p>
        </div>
      )}

      {/* Primary signals callout */}
      <div style={{ background: "#0a0f1a", border: "1px solid #f59e0b33", borderRadius: 12, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>PRIMARY SIGNALS</div>
        <div style={{ color: "#3d5a73", fontSize: 11 }}>S3 · S4 · S10 carry max 5 pts each — these are the core selection criteria</div>
        {(() => {
          const primaryTotal = ["S3","S4","S10"].reduce((a, id) => {
            const r = signalMap.get(id);
            return a + (r?.score ?? 0);
          }, 0);
          const primaryMax = 15;
          const c = pctColor(primaryTotal, primaryMax);
          return (
            <div style={{ marginLeft: "auto", fontWeight: 800, color: c, fontSize: 13, flexShrink: 0 }}>
              {primaryTotal}/{primaryMax}
            </div>
          );
        })()}
      </div>

      {/* Signal cards */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
          <span style={{ color: "#3d5a73", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>12 SIGNALS · AI-SCORED · MAX {max} PTS</span>
          <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
        </div>

        {SIGNALS.map(sig => {
          const result = signalMap.get(sig.id);
          const pending = !result && isAnalyzing;
          const sc = result?.score ?? 0;
          const c = pending ? "#1a2e40" : pctColor(sc, sig.max);
          const isOpen = expanded[sig.id];
          const isPrimary = sig.primary === true;

          return (
            <div key={sig.id} style={{
              background: pending ? "#080e18" : (isPrimary ? "#0c1524" : "#0c1d2c"),
              border: `1px solid ${pending ? "#0f1a28" : (isPrimary ? "#f59e0b33" : "#1a2e40")}`,
              borderRadius: 12, marginBottom: 8, overflow: "hidden",
              opacity: pending ? 0.5 : 1, transition: "opacity 0.4s ease",
            }}>
              {/* Row */}
              <div
                onClick={() => !pending && setExpanded(p => ({ ...p, [sig.id]: !p[sig.id] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: pending ? "default" : "pointer", userSelect: "none" }}
              >
                {/* Badge */}
                <div style={{
                  minWidth: 42, height: 42, borderRadius: 9,
                  background: isPrimary ? "#0f1f35" : "#0a1824",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, color: c,
                  border: `1px solid ${isPrimary ? "#f59e0b44" : c + "33"}`,
                  flexShrink: 0,
                }}>
                  {pending ? "…" : sig.id}
                </div>
                {/* Label + bar */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ color: pending ? "#2e4a60" : (isPrimary ? "#e8d5a3" : "#c8d8e8"), fontWeight: 600, fontSize: 13 }}>{sig.label}</span>
                      {isPrimary && !pending && (
                        <span style={{ background: "#f59e0b22", border: "1px solid #f59e0b44", borderRadius: 4, padding: "1px 6px", fontSize: 9, color: "#f59e0b", fontWeight: 800, letterSpacing: 1 }}>
                          PRIMARY
                        </span>
                      )}
                      {pending && (
                        <span style={{ background: "#0f1a28", border: "1px solid #1a2e40", borderRadius: 4, padding: "1px 6px", fontSize: 9, color: "#2e4a60", fontWeight: 700 }}>
                          RESEARCHING…
                        </span>
                      )}
                    </div>
                    <span style={{ color: c, fontWeight: 700, fontSize: 13, marginLeft: 8, flexShrink: 0 }}>
                      {pending ? `—/${sig.max}` : `${sc}/${sig.max}`}
                    </span>
                  </div>
                  <div style={{ height: 4, background: "#0a1824", borderRadius: 2, overflow: "hidden" }}>
                    {!pending && <div style={{ height: "100%", width: `${sig.max > 0 ? (sc / sig.max) * 100 : 0}%`, background: c, borderRadius: 2 }} />}
                  </div>
                </div>
                {!pending && <div style={{ color: "#1a2e40", fontSize: 16, marginLeft: 6, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>▼</div>}
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding: "0 14px 16px", borderTop: `1px solid ${isPrimary ? "#f59e0b22" : "#1a2e40"}` }}>
                  <p style={{ color: "#7a9ab5", fontSize: 13, lineHeight: 1.7, margin: "14px 0 10px" }}>{sig.what}</p>

                  {result?.reasoning && (
                    <div style={{ background: "#070f1a", borderRadius: 8, padding: "12px 14px", marginBottom: 10 }}>
                      <div style={{ color: "#38bdf8", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 6 }}>AI REASONING</div>
                      <p style={{ color: "#c8d8e8", fontSize: 13, lineHeight: 1.7, margin: 0 }}>{result.reasoning}</p>
                    </div>
                  )}

                  {result?.sources && result.sources.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>SOURCES CHECKED</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {result.sources.map((src, i) => (
                          <span key={i} style={{ background: "#0a1824", border: "1px solid #1a2e40", borderRadius: 6, padding: "3px 10px", color: "#5a7a94", fontSize: 11 }}>
                            {src}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Scoring guide */}
                  <div style={{ background: "#070f1a", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>SCORING GUIDE</div>
                    {Object.entries(sig.scoring).sort((a, b) => Number(b[0]) - Number(a[0])).map(([pt, desc]) => {
                      const p = parseInt(pt);
                      const gc = pctColor(p, sig.max);
                      const isActive = p === sc;
                      return (
                        <div key={pt} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 5 }}>
                          <div style={{
                            minWidth: 24, height: 24, borderRadius: 6,
                            background: isActive ? gc : gc + "22",
                            color: isActive ? "#fff" : gc,
                            fontWeight: 800, fontSize: 12,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0, border: isActive ? `1px solid ${gc}` : "none",
                          }}>{pt}</div>
                          <span style={{ color: isActive ? "#c8d8e8" : "#5a7a94", fontSize: 12, paddingTop: 4, lineHeight: 1.5, fontWeight: isActive ? 600 : 400 }}>{desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center", color: "#1a2e40", fontSize: 11, borderTop: "1px solid #0a1824", paddingTop: 14, marginTop: 16 }}>
        Framework v2.0 · Microcap Multibagger · Personal investment research only · Not financial advice
      </div>
    </div>
  );
}
