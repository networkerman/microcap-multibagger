"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  symbol: string;
  exchange: string;
  companyName: string;
  onSubmit: (email: string) => void;
  loading?: boolean;
}

const STORAGE_KEY = "mmb_email";

type AuthState = "loading" | "loggedIn" | "loggedOut";

export default function ContactCapture({ symbol, exchange, companyName, onSubmit, loading }: Props) {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [userEmail, setUserEmail] = useState<string>("");   // account email when logged in
  const [savedEmail, setSavedEmail] = useState<string | null>(null); // remembered anon email
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [inputError, setInputError] = useState("");

  useEffect(() => {
    const supabase = createClient();

    // Check auth first — this determines which UI we show
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserEmail(data.user.email ?? "");
        setAuthState("loggedIn");
      } else {
        // Logged out — check localStorage for remembered email
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) setSavedEmail(stored);
        setAuthState("loggedOut");
      }
    });
  }, []);

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) { setInputError("Please enter a valid email"); return; }
    setInputError("");
    localStorage.setItem(STORAGE_KEY, email);
    setSavedEmail(email);
    onSubmit(email);
  };

  const card = (children: React.ReactNode) => (
    <div style={{
      background: "#0c1d2c", border: "1px solid #1e3448", borderRadius: 16,
      padding: "28px 24px", maxWidth: 460, margin: "0 auto",
    }}>
      {children}
      <p style={{ color: "#2e4a60", fontSize: 11, marginTop: 14, textAlign: "center" }}>
        Reports are shared publicly · Not financial advice
      </p>
    </div>
  );

  const runButton = (onClick?: () => void) => (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={loading}
      style={{
        width: "100%", background: loading ? "#1a2e40" : "#f59e0b", border: "none",
        borderRadius: 9, padding: "13px", color: loading ? "#3d5a73" : "#000",
        fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
      }}
    >
      {loading ? "Starting analysis…" : "Run 12-Signal Analysis →"}
    </button>
  );

  const header = (
    <div style={{ marginBottom: 20 }}>
      <div style={{ color: "#f59e0b", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>
        AI ANALYSIS REQUESTED
      </div>
      <div style={{ color: "#e2e8f0", fontSize: 18, fontWeight: 700, marginBottom: 6 }}>{companyName}</div>
      <div style={{ color: "#3d5a73", fontSize: 13 }}>{symbol} · {exchange} · 12-signal AI analysis</div>
    </div>
  );

  // Don't render until we know auth state — avoids flashing the email form at logged-in users
  if (authState === "loading") return null;

  // ── Logged-in user ──────────────────────────────────────────────────────────
  // No email form. One-click run. Notification goes to their account email.
  if (authState === "loggedIn") {
    return card(
      <>
        {header}
        <div style={{
          background: "#070f1a", border: "1px solid #1a2e40", borderRadius: 9,
          padding: "10px 14px", marginBottom: 14,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#f59e0b22", border: "1px solid #f59e0b44", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ color: "#f59e0b", fontSize: 13 }}>✓</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 1 }}>SIGNED IN · REPORT WILL BE EMAILED TO</div>
            <div style={{ color: "#c8d8e8", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userEmail}</div>
          </div>
        </div>
        {runButton(() => onSubmit(userEmail))}
      </>
    );
  }

  // ── Anonymous: remembered email ─────────────────────────────────────────────
  if (savedEmail && !editing) {
    return card(
      <>
        {header}
        <div style={{
          background: "#070f1a", border: "1px solid #1a2e40", borderRadius: 9,
          padding: "10px 14px", marginBottom: 14,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>NOTIFY WHEN READY</div>
            <div style={{ color: "#c8d8e8", fontSize: 13 }}>{savedEmail}</div>
          </div>
          <button
            onClick={() => { setEditing(true); setEmail(savedEmail); }}
            style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 12, cursor: "pointer", padding: "4px 8px", textDecoration: "underline" }}
          >
            change
          </button>
        </div>
        {runButton(() => onSubmit(savedEmail))}

        {/* Nudge to sign up — if they sign in, their email is already known */}
        <div style={{ marginTop: 12, padding: "10px 12px", background: "#070f1a", border: "1px solid #1a2e40", borderRadius: 8 }}>
          <span style={{ color: "#3d5a73", fontSize: 12 }}>
            Want to save this to a watchlist?{" "}
            <button
              onClick={() => {
                // Pass the remembered email to login page so user doesn't retype it
                router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}&email=${encodeURIComponent(savedEmail)}`);
              }}
              style={{ background: "none", border: "none", color: "#38bdf8", fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >
              Sign in free →
            </button>
          </span>
        </div>
      </>
    );
  }

  // ── Anonymous: new user or editing ──────────────────────────────────────────
  return card(
    <>
      {editing && (
        <button
          onClick={() => { setEditing(false); setInputError(""); }}
          style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 16 }}
        >
          ← back
        </button>
      )}
      {header}
      <form onSubmit={submitNew}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", color: "#5a7a94", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Email — we&apos;ll send the full report to you when it&apos;s ready
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            style={{
              width: "100%", background: "#070f1a", border: "1px solid #1e3448",
              borderRadius: 9, padding: "12px 14px", color: "#e2e8f0", fontSize: 14,
              outline: "none", boxSizing: "border-box",
            }}
          />
          {inputError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>{inputError}</div>}
        </div>
        {runButton()}
      </form>
    </>
  );
}
