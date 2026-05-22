// ---------------------------------------------------------------------------
// Feedback — "report a bug / suggest an improvement" from Settings.
//
// Emails the developer (recipient hard-coded server-side so it's never
// exposed to the client / shown in the UI). Delivery uses Resend's HTTP API
// — set RESEND_API_KEY in the environment. With a free Resend account you
// can send FROM onboarding@resend.dev TO the account owner's address with no
// domain verification, which is enough for this. Override the From address
// with FEEDBACK_FROM once a domain is verified.
//
// The reporter's email is included in the body + reply-to (so the dev can
// follow up) but is never surfaced in the UI.
// ---------------------------------------------------------------------------

"use server";

import { createClient } from "@/lib/supabase/server";

// Where feedback is delivered. Intentionally NOT exposed to the client.
const FEEDBACK_TO = "stephenmckeyes@gmail.com";

export type FeedbackState = { error: string } | { ok: true } | null;

export async function submitFeedback(
  _prev: FeedbackState,
  formData: FormData
): Promise<FeedbackState> {
  const type = String(formData.get("type") ?? "bug");
  const kind = type === "idea" ? "idea" : "bug";
  const message = String(formData.get("message") ?? "").trim();

  if (!message) return { error: "Please write a short message first." };
  if (message.length > 4000) {
    return { error: "That's a bit long — keep it under 4000 characters." };
  }

  // Reporter context (for the dev's reply / triage). Best-effort.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const reporter = user?.email ?? "unknown";

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      error:
        "Feedback delivery isn't set up yet (missing RESEND_API_KEY). Your note wasn't sent.",
    };
  }

  const from =
    process.env.FEEDBACK_FROM ?? "Mission Feedback <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [FEEDBACK_TO],
        reply_to: reporter !== "unknown" ? reporter : undefined,
        subject: `[Mission ${kind === "idea" ? "Idea" : "Bug"}] new feedback`,
        text:
          `Type: ${kind}\n` +
          `From: ${reporter}\n` +
          `User ID: ${user?.id ?? "unknown"}\n\n` +
          message,
      }),
    });

    if (!res.ok) {
      // Don't leak provider internals to the client; log for the dev.
      const detail = await res.text().catch(() => "");
      console.error("Resend feedback send failed:", res.status, detail);
      return {
        error: "Couldn't send right now — please try again in a moment.",
      };
    }
  } catch (e) {
    console.error("Feedback send threw:", e);
    return { error: "Couldn't send right now — please try again in a moment." };
  }

  return { ok: true };
}
