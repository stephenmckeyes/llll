// ---------------------------------------------------------------------------
// CommunityShell — bounded app-shell layout for the Community surface
// (Friends / Groups / Clubs / Guilds), mirroring the Schedule surface:
//
//   [compact top: "← Mission" back link, no big title]
//   [scrollable body — the page's content]
//   [tab strip pinned at the BOTTOM, inverted left→right, just above the
//    global BottomNav]
//
// Only the body scrolls; the back link and the tab strip stay put — the
// same feel as Calendar / Streaks / Total. `h-full` fills the app-shell
// scroll region (layout.tsx), so this must be rendered as a page's <main>.
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";

import { FriendsTabs, type FriendsTabKind } from "./_friends-tabs";

export function CommunityShell({
  active,
  children,
}: {
  active: FriendsTabKind;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col bg-white px-6 pt-6 dark:bg-zinc-950">
      <header className="mb-3 shrink-0">
        <PendingLink
          href="/"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </PendingLink>
      </header>

      <div className="flex flex-1 min-h-0 flex-col gap-6 overflow-y-auto overflow-x-hidden">
        {children}
      </div>

      {/* Bottom-anchored tab strip — mirrors the Schedule ViewSwitcher's
          footer band. Inverted so the order reads
          [Guilds, Clubs, Groups, Friends]. */}
      <div className="shrink-0 border-t border-zinc-200 bg-white pt-2 pb-3 dark:border-zinc-800 dark:bg-zinc-950">
        <FriendsTabs active={active} bottomAnchored />
      </div>
    </main>
  );
}
