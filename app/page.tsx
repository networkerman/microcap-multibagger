import StockSearch from "@/components/StockSearch";
import Leaderboard from "@/components/Leaderboard";

export default function Home() {
  return (
    <main style={{ background: "#060f18", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "60px 16px", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 20 }}>
            MICROCAP MULTIBAGGER · FRAMEWORK v2.0
          </div>
          <h1 style={{ margin: "0 0 12px", fontSize: 42, fontWeight: 900, color: "#ffd700", letterSpacing: -1.5, lineHeight: 1.1 }}>
            12-Signal<br />Stock Analyser
          </h1>
          <p style={{ margin: "0 auto", color: "#3d5a73", fontSize: 15, maxWidth: 440, lineHeight: 1.7 }}>
            AI-powered analysis across 12 signals designed to find policy-driven, high-growth Indian microcaps before the market does.
          </p>
        </div>

        {/* Search */}
        <StockSearch />

        {/* Leaderboard — server-rendered, shows top 3 from last 30 days */}
        <Leaderboard />

        {/* How it works */}
        <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { n: "1", t: "Search", d: "Type any NSE or BSE listed company name or symbol" },
            { n: "2", t: "AI Scores It", d: "Claude analyses 12 signals using public filings and data" },
            { n: "3", t: "Get Report", d: "Report emailed to you — also public for all to see" },
          ].map(step => (
            <div key={step.n} style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 12, padding: "16px 14px" }}>
              <div style={{ color: "#f59e0b", fontWeight: 900, fontSize: 22, marginBottom: 6 }}>{step.n}</div>
              <div style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{step.t}</div>
              <div style={{ color: "#3d5a73", fontSize: 12, lineHeight: 1.5 }}>{step.d}</div>
            </div>
          ))}
        </div>

        {/* Score bands */}
        <div style={{ marginTop: 20, background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 12 }}>SCORING BANDS · MAX 42 PTS · S3/S4/S10 PRIMARY (5pts each)</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { r: "≥ 30", l: "STRONG BUY", c: "#22c55e" },
              { r: "21–29", l: "WATCHLIST", c: "#f59e0b" },
              { r: "14–20", l: "INVESTIGATE", c: "#f97316" },
              { r: "< 14", l: "AVOID", c: "#ef4444" },
            ].map(b => (
              <div key={b.l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: b.c, flexShrink: 0 }} />
                <span style={{ color: b.c, fontWeight: 700, fontSize: 13, minWidth: 36 }}>{b.r}</span>
                <span style={{ color: "#5a7a94", fontSize: 12 }}>{b.l}</span>
              </div>
            ))}
          </div>
        </div>

        <p style={{ textAlign: "center", color: "#1a2e40", fontSize: 11, marginTop: 32 }}>
          Open source · Reports are public · Not financial advice
        </p>
      </div>
    </main>
  );
}
