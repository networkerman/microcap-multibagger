// Saved analyses dashboard — server component, protected by proxy.ts.
// proxy.ts redirects unauthenticated visitors to /auth/login before this renders.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server-auth";
import { createServiceClient } from "@/lib/supabase/server";

const BAND_COLOR: Record<string, string> = {
  "STRONG BUY": "#22c55e",
  "WATCHLIST":  "#f59e0b",
  "INVESTIGATE":"#f97316",
  "AVOID":      "#ef4444",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/auth/login?next=/dashboard");

  const supabase = createServiceClient();

  // Fetch watchlist
  const { data: watchlist } = await supabase
    .from("user_watchlist")
    .select("symbol, exchange, saved_at")
    .eq("user_id", user.id)
    .order("saved_at", { ascending: false });

  // Enrich with current report data
  let enriched: any[] = [];
  if (watchlist && watchlist.length > 0) {
    const { data: reports } = await supabase
      .from("reports")
      .select("symbol, exchange, company_name, total_score, max_score, band, status, analyzed_at")
      .in("symbol", watchlist.map(w => w.symbol));

    const reportMap = new Map((reports ?? []).map(r => [`${r.exchange}:${r.symbol}`, r]));
    enriched = watchlist.map(w => ({
      ...w,
      ...(reportMap.get(`${w.exchange}:${w.symbol}`) ?? {}),
    }));
  }

  return (
    <div style={{ background: "#060f18", minHeight: "100vh", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "32px 16px", color: "#e2e8f0" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        <Link href="/" style={{ textDecoration: "none" }}>
          <button style={{ background: "none", border: "none", color: "#3d5a73", fontSize: 13, cursor: "pointer", marginBottom: 28, padding: 0 }}>
            ← Back to search
          </button>
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "inline-block", background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 20, padding: "4px 16px", fontSize: 11, color: "#f59e0b", fontWeight: 700, letterSpacing: 2, marginBottom: 14 }}>
            MY WATCHLIST
          </div>
          <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 800 }}>Saved Analyses</div>
          <div style={{ color: "#3d5a73", fontSize: 13, marginTop: 4 }}>{user.email}</div>
        </div>

        {/* Empty state */}
        {enriched.length === 0 && (
          <div style={{ background: "#0c1d2c", border: "1px solid #1a2e40", borderRadius: 16, padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 14 }}>☆</div>
            <div style={{ color: "#c8d8e8", fontWeight: 600, fontSize: 16, marginBottom: 8 }}>No saved stocks yet</div>
            <div style={{ color: "#3d5a73", fontSize: 13, marginBottom: 24 }}>
              Search for any NSE or BSE stock and click "Save to watchlist" after viewing its analysis.
            </div>
            <Link href="/">
              <button style={{ background: "#f59e0b", border: "none", borderRadius: 9, padding: "10px 24px", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
                Search stocks →
              </button>
            </Link>
          </div>
        )}

        {/* Watchlist cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {enriched.map((item: any) => {
            const color = BAND_COLOR[item.band] ?? "#5a7a94";
            const pct = item.total_score && item.max_score
              ? Math.round((item.total_score / item.max_score) * 100)
              : 0;

            return (
              <Link
                key={`${item.exchange}:${item.symbol}`}
                href={`/stock/${item.exchange}:${item.symbol}`}
                style={{ textDecoration: "none" }}
              >
                <div style={{
                  background: "#0c1d2c",
                  border: `1px solid ${item.band ? color + "44" : "#1a2e40"}`,
                  borderRadius: 14,
                  padding: "16px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  cursor: "pointer",
                }}>
                  {/* Exchange badge */}
                  <div style={{
                    minWidth: 44, padding: "4px 8px", borderRadius: 6, textAlign: "center",
                    background: item.exchange === "NSE" ? "#38bdf822" : "#a78bfa22",
                    color: item.exchange === "NSE" ? "#38bdf8" : "#a78bfa",
                    fontSize: 10, fontWeight: 800, letterSpacing: 1,
                  }}>
                    {item.exchange}
                  </div>

                  {/* Name + progress */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.company_name ?? item.symbol}
                    </div>
                    <div style={{ color: "#3d5a73", fontSize: 12, marginBottom: 6 }}>
                      {item.symbol} · saved {timeAgo(item.saved_at)}
                      {item.analyzed_at && <span style={{ color: "#2e4a60" }}> · analysed {timeAgo(item.analyzed_at)}</span>}
                    </div>
                    {item.total_score != null && (
                      <div style={{ height: 3, background: "#1a2e40", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                      </div>
                    )}
                  </div>

                  {/* Score */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {item.total_score != null ? (
                      <>
                        <div style={{ color, fontWeight: 900, fontSize: 22, lineHeight: 1 }}>
                          {item.total_score}
                          <span style={{ color: "#2e4a60", fontSize: 11, fontWeight: 400 }}>/{item.max_score}</span>
                        </div>
                        <div style={{ color, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginTop: 2 }}>{item.band}</div>
                      </>
                    ) : (
                      <div style={{ color: "#2e4a60", fontSize: 12 }}>
                        {item.status === "analyzing" ? "Analysing…" : "No report yet"}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <p style={{ textAlign: "center", color: "#1a2e40", fontSize: 11, marginTop: 40 }}>
          Not financial advice · Scores reflect the last completed analysis
        </p>
      </div>
    </div>
  );
}
