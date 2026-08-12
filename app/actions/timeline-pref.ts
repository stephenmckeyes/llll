"use server";

// ---------------------------------------------------------------------------
// Timeline is a STICKY user preference, not a per-URL flag: turning
// it on in Day view should keep it on when the user visits Month or
// Year and then drills back into a specific day. Storing that in a
// cookie means every server render reads the current preference
// without callers having to thread `&timeline=1` through every link
// in the Calendar surface.
//
// Cookie value is "1" for on, "0" for off, absent = off (default).
// Long TTL — this is a UI preference, not sensitive state.
// ---------------------------------------------------------------------------

import { cookies } from "next/headers";

const COOKIE_NAME = "mission-timeline";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setTimelinePref(on: boolean): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, on ? "1" : "0", {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax",
    httpOnly: false,
  });
}

export async function readTimelinePref(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value === "1";
}
