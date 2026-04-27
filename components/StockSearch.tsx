"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Instrument {
  symbol: string;
  name: string;
  exchange: string;
}

export default function StockSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }

    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  const select = (inst: Instrument) => {
    setOpen(false);
    setQuery("");
    router.push(`/stock/${inst.exchange}:${inst.symbol}`);
  };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search by company name or NSE/BSE symbol…"
            style={{
              width: "100%",
              background: "#0c1d2c",
              border: "1px solid #1e3448",
              borderRadius: 12,
              padding: "14px 18px",
              color: "#e2e8f0",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {loading && (
            <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#3d5a73", fontSize: 12 }}>
              searching…
            </div>
          )}
        </div>
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
          background: "#0c1d2c", border: "1px solid #1e3448", borderRadius: 12,
          overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          {results.map((inst, i) => (
            <button
              key={`${inst.exchange}:${inst.symbol}`}
              onMouseDown={() => select(inst)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "12px 16px", background: "none",
                border: "none", borderBottom: i < results.length - 1 ? "1px solid #1a2e40" : "none",
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#1a2e40")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <div style={{
                minWidth: 52, padding: "3px 8px", borderRadius: 6,
                background: inst.exchange === "NSE" ? "#38bdf822" : "#a78bfa22",
                color: inst.exchange === "NSE" ? "#38bdf8" : "#a78bfa",
                fontSize: 10, fontWeight: 800, textAlign: "center", letterSpacing: 1,
              }}>
                {inst.exchange}
              </div>
              <div>
                <div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{inst.name}</div>
                <div style={{ color: "#3d5a73", fontSize: 12 }}>{inst.symbol}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && results.length === 0 && !loading && query.length >= 2 && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
          background: "#0c1d2c", border: "1px solid #1e3448", borderRadius: 12,
          padding: "16px", color: "#3d5a73", fontSize: 13, textAlign: "center",
        }}>
          No stocks found for "{query}"
        </div>
      )}
    </div>
  );
}
