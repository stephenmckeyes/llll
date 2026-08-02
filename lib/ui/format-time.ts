// ---------------------------------------------------------------------------
// Time formatting — pure helpers + type shared between server + client.
//
// The value is persisted server-side on `profiles.time_format` (migration
// 0024) and mirrored to localStorage for instant client reads. Because
// server components need `formatTime` too (rhythm-summary in the Week /
// Month / Year renderers), this file is deliberately NOT "use client";
// the browser-only pieces (hook, event dispatch) live in
// `format-time-client.ts`.
// ---------------------------------------------------------------------------

export const TIME_FORMATS = ["auto", "12h", "24h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

export function isTimeFormat(v: unknown): v is TimeFormat {
  return typeof v === "string" && (TIME_FORMATS as readonly string[]).includes(v);
}

/**
 * Format an "HH:MM" wire-format time string into the user's chosen shape.
 *   'auto' → `toLocaleTimeString` (browser default — 12h in en-US, 24h in de-DE)
 *   '12h'  → "8:00 AM"
 *   '24h'  → "08:00"
 *
 * Rendering-only: no timezone math (the input is a wall-clock HH:MM, not a
 * timestamp). Falls back to the raw string if parsing fails.
 */
export function formatTime(hhmm: string, format: TimeFormat = "auto"): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  if (format === "24h") {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(format === "12h" ? "en-US" : undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h" ? true : undefined,
  });
}
