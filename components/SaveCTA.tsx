"use client";
// Shown to anonymous users at the top and bottom of an analysis.
// Hidden once the user is logged in (SaveButton in the action bar handles that state).

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Props {
  position: "top" | "bottom";
}

export default function SaveCTA({ position }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<any>(undefined);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Still hydrating or user is logged in — don't show
  if (user !== null) return null;

  const goToLogin = () => {
    router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
  };

  const isTop = position === "top";

  return (
    <div style={{
      background: "#070f1a",
      border: "1px solid #1e3448",
      borderRadius: 12,
      padding: "14px 18px",
      marginBottom: isTop ? 20 : 0,
      marginTop: isTop ? 0 : 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap",
    }}>
      <div>
        <div style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 13, marginBottom: 3 }}>
          ☆ Save this analysis to your watchlist
        </div>
        <div style={{ color: "#3d5a73", fontSize: 12 }}>
          Log in to track your research over time and build your personal watchlist.
        </div>
      </div>
      <button
        onClick={goToLogin}
        style={{
          background: "#f59e0b", border: "none", borderRadius: 8,
          padding: "9px 18px", color: "#000", fontWeight: 700,
          fontSize: 13, cursor: "pointer", flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        Sign in free →
      </button>
    </div>
  );
}
