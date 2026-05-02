"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  symbol: string;
  exchange: string;
  /** compact=true renders a small pill; false renders the full CTA banner */
  compact?: boolean;
}

export default function SaveButton({ symbol, exchange, compact = false }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<any>(undefined); // undefined = loading, null = logged out
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  // Subscribe to auth state
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Once we know the user, check whether they've saved this stock
  useEffect(() => {
    if (!user) return;
    fetch(`/api/watchlist`)
      .then(r => r.json())
      .then((list: any[]) => {
        setSaved(list.some(w => w.symbol === symbol && w.exchange === exchange));
      })
      .catch(() => {});
  }, [user, symbol, exchange]);

  const goToLogin = () => {
    router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
  };

  const toggle = async () => {
    setLoading(true);
    try {
      const method = saved ? "DELETE" : "POST";
      await fetch("/api/watchlist", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, exchange }),
      });
      setSaved(!saved);
    } finally {
      setLoading(false);
    }
  };

  // Still loading auth state
  if (user === undefined) return null;

  // Logged out — show CTA to sign in
  if (!user) {
    if (compact) {
      return (
        <button
          onClick={goToLogin}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#0c1d2c", border: "1px solid #1a2e40",
            borderRadius: 20, padding: "5px 14px",
            color: "#38bdf8", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}
        >
          ☆ Save to watchlist
        </button>
      );
    }
    return null; // Full CTA is rendered by SaveCTA component
  }

  // Logged in — show save/unsave button
  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        background: saved ? "#f59e0b22" : "#0c1d2c",
        border: `1px solid ${saved ? "#f59e0b55" : "#1a2e40"}`,
        borderRadius: 20, padding: "5px 14px",
        color: saved ? "#f59e0b" : "#5a7a94",
        fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
        transition: "all 0.25s",
      }}
    >
      {saved ? "★ Saved" : "☆ Save to watchlist"}
    </button>
  );
}
