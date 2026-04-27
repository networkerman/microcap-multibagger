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

const BAND_COLORS: Record<string, string> = {
  "STRONG BUY": "#22c55e",
  "WATCHLIST": "#f59e0b",
  "INVESTIGATE": "#f97316",
  "AVOID": "#ef4444",
};
const BAND_BG: Record<string, string> = {
  "STRONG BUY": "#022c11",
  "WATCHLIST": "#1c1005",
  "INVESTIGATE": "#1c0e05",
  "AVOID": "#1f0505",
};

export default function ReportView({ report, onRequestRefresh }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const band = report.band;
  const color = BAND_COLORS[band] ?? "#94a3b8";
  const bg = BAND_BG[band] ?? "#0c1d2c";
  const total = report.total_score;
  const max = report.max_score ?? 36;

  const signalMap = new Map(report.report_signals.map(s => [s.signal_id, s]));
  const analyzedDate = new Date(report.analyzed_at).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric"
  });

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>
          MICROCAP MULTIBAGGER · FRAMEWORK v2.0
        </div>
        <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 900, color: "#ffd700" }}>
          {report.company_name}
        </h1>
        <div style={{ color: "#3d5a73", fontSize: 13 }}>
          {report.symbol} · {report.exchange} · Analysed {analyzedDate}
        </div>
        {report.expired && (
          <div style={{ marginTop: 10, display: "inline-block", background: "#f59e0b22", border: "1px solid #f59e0b55", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "#f59e0b" }}>
            ⚠ Report is over 90 days old.{" "}
            {onRequestRefresh && (
              <button onClick={onRequestRefresh} style={{ color: "#f59e0b", background: "none", border: "none", fontWeight: 700, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                Request fresh analysis
              </button>
            )}
          </div>
        )}
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
            { r: "≥26", l: "STRONG BUY", c: "#22c55e", a: total >= 26 },
            { r: "18–25", l: "WATCHLIST", c: "#f59e0b", a: total >= 18 && total < 26 },
            { r: "12–17", l: "INVESTIGATE", c: "#f97316", a: total >= 12 && total < 18 },
            { r: "<12", l: "AVOID", c: "#ef4444", a: total < 12 },
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

      {/* Signal cards */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
          <span style={{ color: "#3d5a73", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>12 SIGNALS · AI-SCORED</span>
          <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
        </div>

        {SIGNALS.map(sig => {
          const result = signalMap.get(sig.id);
          const sc = result?.score ?? 0;
          const c = pctColor(sc, sig.max);
          const isOpen = expanded[sig.id];

          return (
            <div key={sig.id} style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
              {/* Row */}
              <div
                onClick={() => setExpanded(p => ({ ...p, [sig.id]: !p[sig.id] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer", userSelect: "none" }}
              >
                {/* Badge */}
                <div style={{ minWidth: 42, height: 42, borderRadius: 9, background: "#0a1824", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: c, border: `1px solid ${c}33`, flexShrink: 0 }}>
                  {sig.id}
                </div>
                {/* Label + bar */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 13 }}>{sig.label}</span>
                    <span style={{ color: c, fontWeight: 700, fontSize: 13, marginLeft: 8, flexShrink: 0 }}>{sc}/{sig.max}</span>
                  </div>
                  <div style={{ height: 4, background: "#0a1824", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${sig.max > 0 ? (sc / sig.max) * 100 : 0}%`, background: c, borderRadius: 2 }} />
                  </div>
                </div>
                <div style={{ color: "#1a2e40", fontSize: 16, marginLeft: 6, transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "none", flexShrink: 0 }}>▼</div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding: "0 14px 16px", borderTop: "1px solid #1a2e40" }}>
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
                      return (
                        <div key={pt} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 5 }}>
                          <div style={{ minWidth: 24, height: 24, borderRadius: 6, background: gc + "22", color: gc, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{pt}</div>
                          <span style={{ color: p === sc ? "#c8d8e8" : "#5a7a94", fontSize: 12, paddingTop: 4, lineHeight: 1.5, fontWeight: p === sc ? 600 : 400 }}>{desc}</span>
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
