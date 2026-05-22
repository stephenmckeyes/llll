// ---------------------------------------------------------------------------
// GET /api/ping — lightweight keep-warm endpoint.
//
// The 2–10s variance on first navigation isn't query speed (the DB is
// already fully indexed) or region latency (Vercel pdx1 and Supabase
// Oregon are the same US-West region). It's COLD STARTS: after a few
// minutes idle, the Vercel serverless function spins down, and the next
// request pays the spin-up cost.
//
// Point a free uptime monitor (e.g. UptimeRobot) at this URL every ~5
// minutes. Each hit keeps the serverless function warm and exercises a
// trivial DB round-trip so the first REAL user navigation is fast
// instead of cold. Cheap insurance; no auth required.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Never cache — each ping must actually run to keep things warm.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    // Trivial round-trip to wake the DB connection. As an anonymous
    // request, RLS returns nothing — but the query still exercises the
    // full app → PostgREST → Postgres path, which is the point.
    await supabase.from("tags").select("id", { head: true, count: "exact" });
  } catch {
    // Swallow — returning 200 keeps the uptime monitor happy and the
    // serverless function warm even if the DB momentarily hiccups.
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
