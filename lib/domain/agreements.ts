// ---------------------------------------------------------------------------
// Agreements + first-run intros (migration 0077). Each entry has a stable key
// and a required version; a user's stored acknowledgment version (in
// user_acknowledgments) must be >= the required version, else the intro/terms
// shows. Bump a version to re-prompt everyone (e.g. revised terms).
//
// Plain module (no "use server") so client components can import the content.
// ---------------------------------------------------------------------------

/** True when the user hasn't acknowledged this agreement at its current
 *  version yet (so the intro/terms should be shown). */
export function needsAck(
  acks: Record<string, number>,
  agreement: { key: string; version: number }
): boolean {
  return (acks[agreement.key] ?? 0) < agreement.version;
}

export type Agreement = {
  key: string;
  version: number;
  title: string;
  /** Paragraphs rendered in order. */
  body: string[];
  /** Label for the confirm button (terms) — omitted for plain intros. */
  acceptLabel?: string;
};

// --- First-run intros (dismissible; version 1) -----------------------------

export const COACHES_INTRO: Agreement = {
  key: "intro:coaches",
  version: 1,
  title: "Welcome to Coaches",
  body: [
    "Find a professional coach to help you reach your goals, or become one yourself.",
    "Browse verified coaches, message them, share your activities for review, and accept plans they send straight to your calendar.",
  ],
};

// --- Terms / disclaimers (blocking accept) ---------------------------------

export const COACH_CONDUCT_TERMS: Agreement = {
  key: "terms:coach_conduct",
  version: 1,
  title: "Coach agreement",
  body: [
    "By listing as a coach you agree to act professionally and honestly: represent your experience truthfully, only coach within your competence, and respect the privacy of anything a client shares with you.",
    "Do not use your position to harass, exploit, or mislead clients. Mission may remove a coach listing for abuse or misrepresentation.",
    "You are solely responsible for the guidance you give. Mission is a platform, not a party to any coaching arrangement, and does not verify qualifications beyond basic review.",
  ],
  acceptLabel: "I agree",
};

export const COMMUNITY_CONDUCT_TERMS: Agreement = {
  key: "terms:community_conduct",
  version: 1,
  title: "Community guidelines",
  body: [
    "Communities you create or lead are yours to run, but membership is a position of trust. Treat members fairly, be clear about rules, and don't use leadership tools (ranks, kicks, settings) to harass, exclude unfairly, or mislead people.",
    "Keep shared activities and chat respectful. Don't post content that's abusive, deceptive, or that you don't have the right to share.",
    "Mission is a platform, not a party to your community. You're responsible for how you run it; Mission may remove communities or members for abuse.",
  ],
  acceptLabel: "I agree",
};

export const COACHING_CLIENT_DISCLAIMER: Agreement = {
  key: "terms:coaching_client",
  version: 1,
  title: "Before you engage a coach",
  body: [
    "Coaching here is general guidance, not professional, medical, legal, or financial advice unless a coach is separately licensed and says so. Use your own judgment and consult a qualified professional for medical or other regulated concerns.",
    "Mission doesn't vet coaches' qualifications beyond a basic review and isn't responsible for the advice, conduct, or any arrangement between you and a coach. Share only what you're comfortable sharing.",
    "Report abuse or misconduct so we can act on it.",
  ],
  acceptLabel: "I understand",
};
