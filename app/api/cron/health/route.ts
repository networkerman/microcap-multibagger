import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// ─── SLA thresholds (ms) ─────────────────────────────────────────────────────
const SLA = {
  FAST: 1000,   // ✅ green
  WARN: 3000,   // ⚠️ yellow
                // ❌ red above WARN
};

type Status = "ok" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: Status;
  latencyMs: number | null;
  detail: string;
}

function icon(s: Status) {
  return s === "ok" ? "✅" : s === "warn" ? "⚠️" : "❌";
}

function badge(ms: number | null): string {
  if (ms === null) return "timeout";
  if (ms < SLA.FAST) return `${ms}ms`;
  if (ms < SLA.WARN) return `${ms}ms ⚠️ slow`;
  return `${ms}ms ❌ critical`;
}

function slaStatus(ms: number | null): Status {
  if (ms === null) return "fail";
  if (ms < SLA.FAST) return "ok";
  if (ms < SLA.WARN) return "warn";
  return "fail";
}

async function timed(fn: () => Promise<string>): Promise<{ latencyMs: number; detail: string; status: Status }> {
  const t = Date.now();
  try {
    const detail = await fn();
    const latencyMs = Date.now() - t;
    return { latencyMs, detail, status: slaStatus(latencyMs) };
  } catch (err: any) {
    return { latencyMs: Date.now() - t, detail: err?.message ?? "error", status: "fail" };
  }
}

// ─── Individual checks ────────────────────────────────────────────────────────

async function checkWebsite(): Promise<CheckResult> {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://microcap-multibagger.vercel.app";
  const r = await timed(async () => {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP 200`;
  });
  return { name: "Website", ...r };
}

async function checkSearchApi(): Promise<CheckResult> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://microcap-multibagger.vercel.app";
  const r = await timed(async () => {
    const res = await fetch(`${base}/api/search?q=INFY`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const count = Array.isArray(data) ? data.length : 0;
    if (count === 0) throw new Error("returned 0 results for INFY");
    return `${count} results`;
  });
  return { name: "Search API (/api/search)", ...r };
}

async function checkSupabase(): Promise<CheckResult> {
  const r = await timed(async () => {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("reports")
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return `${count ?? 0} reports in DB`;
  });
  return { name: "Supabase DB", ...r };
}

async function checkDeepSeek(): Promise<CheckResult> {
  const r = await timed(async () => {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 100)}`);
    }
    const j = await res.json();
    const model = j.model ?? "unknown";
    return `model=${model}`;
  });
  return { name: "DeepSeek API (signal scoring)", ...r };
}

async function checkClaude(): Promise<CheckResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { name: "Claude API (deep analysis)", status: "fail", latencyMs: null, detail: "ANTHROPIC_API_KEY not set" };
  const r = await timed(async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 100)}`);
    }
    const j = await res.json();
    return `model=${j.model ?? "unknown"}`;
  });
  return { name: "Claude API (deep analysis)", ...r };
}

async function checkSerper(): Promise<CheckResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return { name: "Serper API", status: "warn", latencyMs: null, detail: "SERPER_API_KEY not set" };
  const r = await timed(async () => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: "test", gl: "in", num: 1 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hits = data.organic?.length ?? 0;
    return `${hits} result(s)`;
  });
  return { name: "Serper API", ...r };
}

async function checkTavily(): Promise<CheckResult> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { name: "Tavily API", status: "warn", latencyMs: null, detail: "TAVILY_API_KEY not set" };
  const r = await timed(async () => {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: "test", max_results: 1 }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hits = data.results?.length ?? 0;
    return `${hits} result(s)`;
  });
  return { name: "Tavily API", ...r };
}

async function checkScreener(): Promise<CheckResult> {
  const r = await timed(async () => {
    const res = await fetch("https://www.screener.in/api/company/search/?q=INFY", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("returned empty results");
    return `${data.length} result(s)`;
  });
  return { name: "Screener.in", ...r };
}

// ─── Telegram sender ──────────────────────────────────────────────────────────

async function sendTelegram(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[health] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("[health] Telegram send failed:", err);
  } else {
    console.log("[health] Telegram notification sent");
  }
}

// ─── Report formatter ─────────────────────────────────────────────────────────

function formatReport(checks: CheckResult[]): string {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const healthy = checks.filter(c => c.status === "ok").length;
  const warnings = checks.filter(c => c.status === "warn").length;
  const failures = checks.filter(c => c.status === "fail").length;

  const overallIcon = failures > 0 ? "🔴" : warnings > 0 ? "🟡" : "🟢";
  const overallText = failures > 0
    ? `${failures} failure${failures > 1 ? "s" : ""} detected`
    : warnings > 0
    ? `${warnings} slow/warning`
    : "All systems healthy";

  const rows = checks.map(c =>
    `${icon(c.status)} <b>${c.name}</b>\n   ${badge(c.latencyMs)} — ${c.detail}`
  ).join("\n\n");

  return [
    `${overallIcon} <b>Microcap Multibagger — Health Check</b>`,
    `🕐 ${now} IST`,
    ``,
    rows,
    ``,
    `<b>Summary:</b> ${healthy} ok · ${warnings} warn · ${failures} fail — ${overallText}`,
  ].join("\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Vercel cron requests carry an Authorization header with CRON_SECRET.
  // Allow direct calls without auth only in development.
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[health] Starting daily health check");
  const t0 = Date.now();

  const checks = await Promise.all([
    checkWebsite(),
    checkSearchApi(),
    checkSupabase(),
    checkDeepSeek(),
    checkClaude(),
    checkSerper(),
    checkTavily(),
    checkScreener(),
  ]);

  const elapsed = Date.now() - t0;
  console.log(`[health] All checks done in ${(elapsed / 1000).toFixed(1)}s`);
  checks.forEach(c => console.log(`[health] ${icon(c.status)} ${c.name}: ${c.latencyMs ?? "null"}ms — ${c.detail}`));

  const report = formatReport(checks);
  await sendTelegram(report);

  const summary = {
    ok: checks.filter(c => c.status === "ok").length,
    warn: checks.filter(c => c.status === "warn").length,
    fail: checks.filter(c => c.status === "fail").length,
    checks: checks.map(c => ({ name: c.name, status: c.status, latencyMs: c.latencyMs, detail: c.detail })),
    elapsedMs: elapsed,
  };

  return NextResponse.json(summary);
}
