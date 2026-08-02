// ---------------------------------------------------------------------------
// ICS (iCalendar) generator for the read-only calendar-export feed.
//
// A subscribed calendar (iOS, Google, Outlook, Fantastical, …) fetches the
// URL, parses the VCALENDAR body, and creates one VEVENT per instance.
// The events are deduplicated by UID across fetches — each Mission
// instance has a stable UID so completing an occurrence, editing its
// name, etc., updates the existing event rather than creating a new one.
//
// This module is deliberately dependency-free and server-safe. The API
// route wraps it and sets the response Content-Type.
// ---------------------------------------------------------------------------

export type IcsInstance = {
  /** activity_instances.id — becomes part of the UID. */
  instanceId: string;
  /** Scheduled date, YYYY-MM-DD. */
  scheduledFor: string;
  /** Optional wall-clock start time, HH:MM. Missing → all-day event. */
  scheduledTime: string | null;
  /** Human-readable name (respects per-instance overrides). */
  name: string;
  /** Optional description body (respects per-instance overrides). */
  notes: string | null;
  /** 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE'. See maps below. */
  status: "pending" | "completed" | "missed";
  /** ISO-8601 timestamp — bumped whenever the row changes so the
   *  calendar picks up edits on the next sync. */
  updatedAt: string;
};

export type IcsCalendarOptions = {
  /** Shown in the calendar app's list of subscribed calendars. */
  calendarName?: string;
  /** How often clients should refresh — ISO 8601 duration. */
  publishedTtl?: string;
  /** Optional timezone id (e.g. "America/New_York") used for local-time
   *  events. When omitted, timed events are emitted as UTC (which most
   *  calendars display correctly but shifts as the user travels). */
  timezone?: string;
};

// Fold long text properties to satisfy RFC 5545: lines >75 octets must
// be split. Simple char-count wrap is safe here because our content
// is ASCII (name, notes) after escaping. Continuation lines start with
// a single space.
function fold(line: string): string {
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + 74);
    chunks.push(i === 0 ? chunk : " " + chunk);
    i += 74;
  }
  return chunks.join("\r\n");
}

// Escape TEXT-typed properties: backslash, semicolon, comma, and newline.
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function ymdCompact(ymd: string): string {
  return ymd.replace(/-/g, "");
}

function toUtcStamp(iso: string): string {
  // "2026-07-31T15:04:00Z" → "20260731T150400Z"
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Combine `YYYY-MM-DD` + `HH:MM` in a given IANA timezone and emit the
 * corresponding UTC iCalendar timestamp. If `tz` is omitted, the wall-
 * clock is treated as-if UTC (least-surprising fallback).
 */
function localDateTimeToUtcStamp(
  ymd: string,
  hhmm: string,
  tz?: string
): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  if (!tz) {
    // No tz → treat the given wall-clock as UTC directly.
    const iso = `${ymd}T${String(hh).padStart(2, "0")}:${String(
      mm
    ).padStart(2, "0")}:00Z`;
    return toUtcStamp(iso);
  }
  // Compute the offset for that instant in that timezone via a rendered
  // UTC-string round-trip. See:
  //  https://stackoverflow.com/a/54127122
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const inTz = new Date(
    dt.toLocaleString("en-US", { timeZone: tz })
  );
  const offsetMs = inTz.getTime() - dt.getTime();
  const realUtc = new Date(dt.getTime() - offsetMs);
  return toUtcStamp(realUtc.toISOString());
}

const STATUS_MAP: Record<IcsInstance["status"], string> = {
  pending: "CONFIRMED",
  completed: "CONFIRMED",
  missed: "CANCELLED",
};

export function buildCalendar(
  instances: IcsInstance[],
  opts: IcsCalendarOptions = {}
): string {
  const {
    calendarName = "Mission",
    publishedTtl = "PT1H",
    timezone,
  } = opts;
  const now = toUtcStamp(new Date().toISOString());

  const header: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mission//Mission Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `NAME:${escapeText(calendarName)}`,
    `X-PUBLISHED-TTL:${publishedTtl}`,
    // Ask Google Calendar to refresh at the same TTL cadence.
    `REFRESH-INTERVAL;VALUE=DURATION:${publishedTtl}`,
  ];

  const events: string[] = [];
  for (const inst of instances) {
    const uid = `instance-${inst.instanceId}@mission`;
    const dtstamp = toUtcStamp(inst.updatedAt);
    const summary = escapeText(inst.name);
    const description = inst.notes ? escapeText(inst.notes) : "";
    const status = STATUS_MAP[inst.status];

    const evt: string[] = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${now}`];
    if (inst.scheduledTime) {
      const stamp = localDateTimeToUtcStamp(
        inst.scheduledFor,
        inst.scheduledTime,
        timezone
      );
      evt.push(`DTSTART:${stamp}`);
      // Default 30-minute duration — Mission doesn't model end times, but
      // most calendar apps render zero-length events as a thin bar users
      // struggle to tap. Half-hour default is unobtrusive and clearly
      // "roughly this long".
      evt.push(`DURATION:PT30M`);
    } else {
      // All-day event: VALUE=DATE.
      evt.push(`DTSTART;VALUE=DATE:${ymdCompact(inst.scheduledFor)}`);
    }
    evt.push(fold(`SUMMARY:${summary}`));
    if (description) evt.push(fold(`DESCRIPTION:${description}`));
    evt.push(`STATUS:${status}`);
    // Bumps whenever the row changes so subscribers detect edits.
    evt.push(`LAST-MODIFIED:${dtstamp}`);
    evt.push("TRANSP:OPAQUE");
    evt.push("END:VEVENT");

    events.push(evt.join("\r\n"));
  }

  const footer = ["END:VCALENDAR"];

  // CRLF line endings per RFC 5545; final blank line included.
  return (
    header.join("\r\n") +
    "\r\n" +
    events.join("\r\n") +
    (events.length ? "\r\n" : "") +
    footer.join("\r\n") +
    "\r\n"
  );
}
