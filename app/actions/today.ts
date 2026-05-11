// ---------------------------------------------------------------------------
// Server actions used by /today.
// (The full create-activity flow lives at /activities/new and uses its own
//  action file.)
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logCompletion } from "@/lib/domain/completions";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// completeInstance — wraps logCompletion() with the per-instance flavor.
// For frequency rhythms, logCompletion knows to keep the instance pending
// until the configured count is reached.
// ---------------------------------------------------------------------------

export async function completeInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await logCompletion(supabase, user.id, {
    instanceIds: [instanceId],
  });

  revalidatePath("/today");
}
