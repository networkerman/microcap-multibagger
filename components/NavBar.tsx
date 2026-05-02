"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function NavBar() {
  const router = useRouter();
  const [user, setUser] = useState<any>(undefined); // undefined = loading

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  };

  // Don't render anything until auth state resolves (avoids flash)
  if (user === undefined) return null;

  return (
    <nav style={{
      background: "#060f18",
      borderBottom: "1px solid #0a1824",
      padding: "10px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: 0,
      zIndex: 50,
    }}>
      <Link href="/" style={{ textDecoration: "none" }}>
        <span style={{ color: "#f59e0b", fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>
          MMB
        </span>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {user ? (
          <>
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <span style={{ color: "#5a7a94", fontSize: 13, cursor: "pointer" }}>
                ☆ Watchlist
              </span>
            </Link>
            <span style={{ color: "#1a2e40", fontSize: 12 }}>·</span>
            <span style={{ color: "#3d5a73", fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email}
            </span>
            <button
              onClick={signOut}
              style={{ background: "none", border: "1px solid #1a2e40", borderRadius: 8, padding: "4px 10px", color: "#3d5a73", fontSize: 12, cursor: "pointer" }}
            >
              Sign out
            </button>
          </>
        ) : (
          <Link href="/auth/login" style={{ textDecoration: "none" }}>
            <button style={{ background: "none", border: "1px solid #1a2e40", borderRadius: 8, padding: "5px 12px", color: "#38bdf8", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              Sign in
            </button>
          </Link>
        )}
      </div>
    </nav>
  );
}
