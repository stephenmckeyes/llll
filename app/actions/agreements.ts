"use server";

// ---------------------------------------------------------------------------
// Acknowledgments (migration 0077) — first-run intros + terms acceptance.
// ---------------------------------------------------------------------------

import { createClient } from "@/lib/supabase/server";

// All of the caller's acknowledgments as { ack_key: version }. The client
// compares each against the required version in lib/domain/agreements.ts.
export async function getAcknowledgments(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};
  const { data } = await supabase
    .from("user_acknowledgments")
    .select("ack_key, version")
    .eq("user_id", user.id);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ ack_key: string; version: number }>) {
    out[r.ack_key] = r.version;
  }
  return out;
}

// Clear the caller's first-run INTRO acknowledgments (keys like "intro:*") so
// the intro popups show again. Leaves terms acceptances (terms:*) untouched.
export async function resetSeenIntros(): Promise<
  { error: string } | { ok: true }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("user_acknowledgments")
    .delete()
    .eq("user_id", user.id)
    .like("ack_key", "intro:%");
  if (error) return { error: error.message };
  return { ok: true };
}

// Record that the caller has seen an intro / accepted a terms version.
export async function acknowledge(
  ackKey: string,
  version: number
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("user_acknowledgments")
    .upsert(
      {
        user_id: user.id,
        ack_key: ackKey,
        version,
        acknowledged_at: new Date().toISOString(),
      },
      { onConflict: "user_id,ack_key" }
    );
  if (error) return { error: error.message };
  return { ok: true };
}
