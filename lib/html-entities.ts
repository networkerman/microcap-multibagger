/**
 * Decodes common HTML entities in a string.
 * Used at data-ingestion time (Kite CSV, Screener HTML) so the DB always
 * stores plain text and React's auto-escaping never double-encodes.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
