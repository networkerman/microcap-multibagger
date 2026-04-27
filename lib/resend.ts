import { Resend } from "resend";
import { getBand } from "./signals";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

export async function sendReportReadyEmail({
  to,
  companyName,
  symbol,
  exchange,
  totalScore,
  band,
  reportUrl,
}: {
  to: string;
  companyName: string;
  symbol: string;
  exchange: string;
  totalScore: number;
  band: string;
  reportUrl: string;
}) {
  const bandColors: Record<string, string> = {
    "STRONG BUY": "#22c55e",
    "WATCHLIST": "#f59e0b",
    "INVESTIGATE": "#f97316",
    "AVOID": "#ef4444",
  };
  const color = bandColors[band] ?? "#94a3b8";

  await getResend().emails.send({
    from: process.env.FROM_EMAIL!,
    to,
    subject: `${companyName} (${symbol}) · ${band} · ${totalScore}/36 — Microcap Multibagger Report`,
    html: `
<!DOCTYPE html>
<html>
<body style="background:#060f18;color:#e2e8f0;font-family:Inter,sans-serif;padding:32px;max-width:600px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="background:#f59e0b18;border:1px solid #f59e0b44;border-radius:20px;display:inline-block;padding:4px 16px;font-size:11px;color:#f59e0b;font-weight:700;letter-spacing:2px;">
      MICROCAP MULTIBAGGER · FRAMEWORK v2.0
    </div>
  </div>

  <h1 style="color:#ffd700;font-size:24px;margin:0 0 4px;">12-Signal Analysis Ready</h1>
  <p style="color:#5a7a94;margin:0 0 24px;">${companyName} · ${symbol} · ${exchange}</p>

  <div style="background:#0c1d2c;border:2px solid ${color};border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
    <div style="font-size:64px;font-weight:900;color:${color};line-height:1;">${totalScore}</div>
    <div style="color:#5a7a94;font-size:16px;margin-bottom:12px;">out of 36</div>
    <div style="display:inline-block;background:${color}22;border:2px solid ${color};border-radius:10px;padding:10px 24px;">
      <span style="color:${color};font-weight:900;font-size:18px;letter-spacing:2px;">${band}</span>
    </div>
  </div>

  <div style="text-align:center;margin-bottom:32px;">
    <a href="${reportUrl}" style="background:#f59e0b;color:#000;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:16px;">
      View Full Report →
    </a>
  </div>

  <p style="color:#2e4a60;font-size:11px;text-align:center;border-top:1px solid #1a2e40;padding-top:16px;">
    Framework v2.0 · Personal investment research only · Not financial advice
  </p>
</body>
</html>`,
  });
}
