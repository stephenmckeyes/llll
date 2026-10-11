"use client";

// ---------------------------------------------------------------------------
// FindCoachView — the dedicated "Find a Coach" directory page. Browse verified
// coaches and engage one (gated behind the client disclaimer on first use).
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startCoaching, type CoachDirectoryEntry } from "@/app/actions/coaches";
import { TermsModal } from "@/app/_components/agreement-prompts";
import { COACHING_CLIENT_DISCLAIMER, needsAck } from "@/lib/domain/agreements";

import { PendingLink } from "@/app/_components/pending-link";
import { CoachCard } from "../coach-ui";

export function FindCoachView({
  directory,
  engagedIds,
  acks,
}: {
  directory: CoachDirectoryEntry[];
  engagedIds: string[];
  acks: Record<string, number>;
}) {
  const router = useRouter();
  const engaged = new Set(engagedIds);
  const [query, setQuery] = useState("");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    !needsAck(acks, COACHING_CLIENT_DISCLAIMER)
  );
  const [pendingEngage, setPendingEngage] = useState<string | null>(null);
  const [, startEngage] = useTransition();

  function doEngage(coachId: string) {
    startEngage(async () => {
      const res = await startCoaching(coachId);
      if (!("error" in res)) router.push(`/friends/coaches/${coachId}/chat`);
    });
  }
  function engage(coachId: string) {
    if (!disclaimerAccepted) setPendingEngage(coachId);
    else doEngage(coachId);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? directory.filter(
        (c) =>
          (c.displayName ?? "").toLowerCase().includes(q) ||
          (c.username ?? "").toLowerCase().includes(q) ||
          (c.bio ?? "").toLowerCase().includes(q)
      )
    : directory;

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col gap-3 bg-white p-4 dark:bg-zinc-950">
      <header className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends/coaches"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Coaches
        </PendingLink>
        <h1 className="text-xl font-semibold tracking-tight">Find a Coach</h1>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search coaches by name or specialty"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </header>

      {pendingEngage && (
        <TermsModal
          agreement={COACHING_CLIENT_DISCLAIMER}
          onCancel={() => setPendingEngage(null)}
          onAccept={() => {
            const id = pendingEngage;
            setPendingEngage(null);
            setDisclaimerAccepted(true);
            if (id) doEngage(id);
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {directory.length === 0
              ? "No coaches listed yet. Verified coaches will show up here."
              : "No coaches match your search."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((c) => (
              <CoachCard
                key={c.userId}
                coach={c}
                engaged={engaged.has(c.userId)}
                onMessage={() => engage(c.userId)}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
