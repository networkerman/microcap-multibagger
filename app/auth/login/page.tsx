"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) { setError("Please enter a valid email"); return; }
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: authErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setLoading(false);
    if (authErr) { setError(authErr.message); return; }
    setSent(true);
  };

  if (sent) {
    return (
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>📬</div>
        <div style={{ color: "#e2e8f0", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Check your email</div>
        <div style={{ color: "#5a7a94", fontSize: 14, lineHeight: 1.7 }}>
          We sent a magic link to <strong style={{ color: "#c8d8e8" }}>{email}</strong>.<br />
          Click it to sign in — no password needed.
        </div>
        <button
          onClick={() => setSent(false)}
          style={{ marginTop: 24, background: "none", border: "1px solid #1a2e40", borderRadius: 8, padding: "8px 16px", color: "#5a7a94", fontSize: 13, cursor: "pointer" }}
        >
          ← Use a different email
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginBottom: 28, textAlign: "center" }}>
        <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 16 }}>
          MICROCAP MULTIBAGGER
        </div>
        <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Sign in to save your research</div>
        <div style={{ color: "#5a7a94", fontSize: 14, lineHeight: 1.6 }}>
          We'll email you a magic link — no password required.<br />
          {next !== "/" && <span style={{ color: "#3d5a73" }}>You'll be taken back to your analysis after signing in.</span>}
        </div>
      </div>

      <form onSubmit={sendMagicLink}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoFocus
          style={{
            width: "100%", background: "#070f1a", border: "1px solid #1e3448",
            borderRadius: 9, padding: "13px 14px", color: "#e2e8f0", fontSize: 15,
            outline: "none", boxSizing: "border-box", marginBottom: 10,
          }}
        />
        {error && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", background: loading ? "#1a2e40" : "#f59e0b", border: "none",
            borderRadius: 9, padding: "13px", color: loading ? "#3d5a73" : "#000",
            fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Sending…" : "Send magic link →"}
        </button>
      </form>

      <button
        onClick={() => router.back()}
        style={{ display: "block", width: "100%", marginTop: 14, background: "none", border: "none", color: "#3d5a73", fontSize: 13, cursor: "pointer", textAlign: "center" }}
      >
        ← Go back
      </button>
    </>
  );
}

export default function LoginPage() {
  return (
    <div style={{ background: "#060f18", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "60px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#0c1d2c", border: "1px solid #1e3448", borderRadius: 16, padding: "36px 28px" }}>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
