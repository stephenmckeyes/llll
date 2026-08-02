// ---------------------------------------------------------------------------
// /api/calendar/[token] — read-only iCalendar feed for a single profile.
//
// Auth is by opaque token (profiles.ics_token, migration 0025), NOT by
// session cookie — subscribers (iOS Calendar, Google Calendar, Outlook,
// Fantastical…) fetch the URL unauthenticated. Rotating the token in
// Settings instantly invalidates every old subscription.
//
// The database query goes through get_instances_by_ics_token (SECURITY
// DEFINER RPC, migration 0025) rather than a service-role client — the
// RPC narrowly exposes just the calendar-relevant fields, gated by the
// token, so there's no service-role env var to leak.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { buildCalendar, type IcsInstance } from "@/lib/domain/ics";
import { createClient } from "@/lib/supabase/server";

// Always render fresh — subscribers fetch on their own cadence and we
// want them to see recent edits without a CDN cache in the way.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Rolling window: past N days + future M days. Kept small so a fat
// subscriber (500-instance history) doesn't page the whole record every
// refresh. Users who want the deep past can export from a future
// dedicated tool.
const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 180;

function ymdOffset(base: Date, deltaDays: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 20) {
    return new NextResponse("Not found.", { status: 404 });
  }

  const supabase = await createClient();

  const now = new Date();
  const from = ymdOffset(now, -WINDOW_PAST_DAYS);
  const to = ymdOffset(now, WINDOW_FUTURE_DAYS);

  const { data, error } = await supabase.rpc("get_instances_by_ics_token", {
    p_token: token,
    p_from: from,
    p_to: to,
  });

  if (error) {
    // Never leak the DB error — return the same "not found" body as
    // an unknown token so a malformed request can't be distinguished.
    return new NextResponse("Not found.", { status: 404 });
  }

  type Row = {
    instance_id: string;
    scheduled_for: string;
    status: string;
    override_name: string | null;
    override_notes: string | null;
    activity_id: string;
    activity_name: string;
    activity_notes: string | null;
    scheduled_times: string[];
    created_at: string;
    owner_timezone: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Empty rows can mean either (a) the token is bogus OR (b) the token
  // is valid but the user has no visible instances in this window.
  // We can't tell them apart without leaking token existence, so both
  // return a valid but empty calendar. Real calendar apps handle that
  // gracefully.
  const instances: IcsInstance[] = rows.map((r) => {
    const st = r.status === "completed" || r.status === "missed"
      ? (r.status as "completed" | "missed")
      : "pending";
    return {
      instanceId: r.instance_id,
      scheduledFor: r.scheduled_for,
      // Use the primary scheduled time from the parent activity. Multi-
      // time activities → we'd need one VEVENT per time; for v1 the
      // primary time is enough. (Multi-time reminders tracked in
      // BACKLOG.)
      scheduledTime: r.scheduled_times[0] ?? null,
      name: r.override_name ?? r.activity_name,
      notes: r.override_notes ?? r.activity_notes,
      status: st,
      updatedAt: r.created_at,
    };
  });

  const ownerTimezone = rows[0]?.owner_timezone ?? undefined;
  const body = buildCalendar(instances, {
    calendarName: "Mission",
    publishedTtl: "PT1H",
    timezone: ownerTimezone,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="mission.ics"',
      // Never cache — subscribers fetch on their own cadence and we
      // want fresh data every time. The X-PUBLISHED-TTL inside the
      // body tells the calendar how often to re-poll.
      "Cache-Control": "no-store",
    },
  });
}
