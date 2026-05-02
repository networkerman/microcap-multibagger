// Server component — fetches leaderboard data directly (no client-side fetch needed).
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";

interface LeaderboardEntry {
  symbol: string;
  exchange: string;
  company_name: string;
  total_score: number;
  max_score: number;
  band: string;
  analyzed_at: string;
}

const BAND_COLOR: Record<string, string> = {
  "STRONG BUY": "#22c55e",
  "WATCHLIST":  "#f59e0b",
  "INVESTIGATE":"#f97316",
  "AVOID":      "#ef4444",
};

const MEDALS = ["🥇", "🥈", "🥉"];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("reports")
      .select("symbol, exchange, company_name, total_score, max_score, band, analyzed_at")
      .eq("status", "complete")
      .not("total_score", "is", null)
      .gte("analyzed_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order("total_score", { ascending: false })
      .order("analyzed_at", { ascending: false })
      .limit(3);
    return data ?? [];
  } catch {
    return [];
  }
}

export default async function Leaderboard() {
  const entries = await fetchLeaderboard();
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
        <span style={{ color: "#3d5a73", fontSize: 10, fontWeight: 700, letterSpacing: 2 }}>
          TOP SCORES · LAST 30 DAYS
        </span>
        <div style={{ height: 1, flex: 1, background: "#1a2e40" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry, i) => {
          const color = BAND_COLOR[entry.band] ?? "#94a3b8";
          const pct = Math.round((entry.total_score / (entry.max_score ?? 42)) * 100);

          return (
            <Link
              key={`${entry.exchange}:${entry.symbol}`}
              href={`/stock/${entry.exchange}:${entry.symbol}`}
              style={{ textDecoration: "none" }}
            >
              <div style={{
                background: "#0c1d2c",
                border: `1px solid ${color}33`,
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                cursor: "pointer",
                transition: "border-color 0.2s",
              }}>
                {/* Medal + rank */}
                <div style={{ fontSize: 20, flexShrink: 0, width: 28, textAlign: "center" }}>
                  {MEDALS[i]}
                </div>

                {/* Company info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.company_name}
                    </span>
                    <span style={{ background: entry.exchange === "NSE" ? "#38bdf822" : "#a78bfa22", color: entry.exchange === "NSE" ? "#38bdf8" : "#a78bfa", fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>
                      {entry.exchange}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 3, background: "#1a2e40", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                  </div>
                </div>

                {/* Score + band */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ color, fontWeight: 900, fontSize: 20, lineHeight: 1 }}>
                    {entry.total_score}
                    <span style={{ color: "#2e4a60", fontSize: 12, fontWeight: 400 }}>/{entry.max_score ?? 42}</span>
                  </div>
                  <div style={{ color, fontSize: 9, fontWeight: 800, letterSpacing: 1, marginTop: 2 }}>{entry.band}</div>
                  <div style={{ color: "#2e4a60", fontSize: 10, marginTop: 2 }}>{timeAgo(entry.analyzed_at)}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
