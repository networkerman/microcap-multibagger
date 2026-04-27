"use client";

import { useState } from "react";

interface Props {
  symbol: string;
  exchange: string;
  companyName: string;
  onSubmit: (email: string) => void;
  loading?: boolean;
}

export default function ContactCapture({ symbol, exchange, companyName, onSubmit, loading }: Props) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) { setError("Please enter a valid email address"); return; }
    setError("");
    onSubmit(email);
  };

  return (
    <div style={{
      background: "#0c1d2c", border: "1px solid #1e3448", borderRadius: 16,
      padding: "28px 24px", maxWidth: 460, margin: "0 auto",
    }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>
          AI ANALYSIS REQUESTED
        </div>
        <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
          {companyName}
        </div>
        <div style={{ color: "#3d5a73", fontSize: 13 }}>
          {symbol} · {exchange} · 12-signal AI analysis · takes 1–3 minutes
        </div>
      </div>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", color: "#5a7a94", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Email address — we'll notify you when the report is ready
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%", background: "#070f1a", border: "1px solid #1e3448",
              borderRadius: 9, padding: "12px 14px", color: "#e2e8f0", fontSize: 14,
              outline: "none", boxSizing: "border-box",
            }}
          />
          {error && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>{error}</div>}
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", background: loading ? "#1a2e40" : "#f59e0b", border: "none",
            borderRadius: 9, padding: "13px", color: loading ? "#3d5a73" : "#000",
            fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Running analysis…" : "Run 12-Signal Analysis →"}
        </button>
      </form>

      <p style={{ color: "#2e4a60", fontSize: 11, marginTop: 14, textAlign: "center" }}>
        Reports are shared publicly. Not financial advice.
      </p>
    </div>
  );
}
