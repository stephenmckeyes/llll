// ---------------------------------------------------------------------------
// FriendsTabs — the top-level tab switcher shared by /friends and its
// sibling routes /friends/groups, /friends/clubs, /friends/coaches.
//
// Same visual pattern as SectionTabs (which fronts Calendar / Streaks /
// Total on the Schedule surface). The "Friends" tab is the existing
// per-person view; Groups / Clubs are community types (many per user, each
// with their own dropdown selector inside the tab); Coaches is a
// placeholder for the upcoming professional-coaching marketplace. Guilds are
// temporarily closed (being reworked) — no tab, route redirects to /friends.
//
// Kept in its own file so all four pages render the tab strip
// identically without dragging component state into the page bodies.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { TabPending } from "@/app/_components/tab-pending";

export type FriendsTabKind =
  | "friends"
  | "groups"
  | "clubs"
  | "guilds"
  | "coaches";

export function FriendsTabs({
  active,
  bottomAnchored = false,
}: {
  active: FriendsTabKind;
  /** When true, render the strip inverted left→right (flex-row-reverse)
   *  so the visual order is [Guilds, Clubs, Groups, Friends] — matching
   *  the bottom-anchored Schedule tabs. DOM order stays Friends-first. */
  bottomAnchored?: boolean;
}) {
  return (
    <nav
      aria-label="Community section"
      className={`flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800 ${
        bottomAnchored ? "flex-row-reverse" : ""
      }`}
    >
      <FriendsTab label="Friends" href="/friends" active={active === "friends"} />
      <FriendsTab label="Groups" href="/friends/groups" active={active === "groups"} />
      <FriendsTab label="Clubs" href="/friends/clubs" active={active === "clubs"} />
      <FriendsTab label="Coaches" href="/friends/coaches" active={active === "coaches"} />
      {/* Guilds are closed for now — being reworked into certified groups that
          create adventures + achievement diaries. Tab hidden; route redirects. */}
    </nav>
  );
}

function FriendsTab({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-1 items-center justify-center rounded px-3 py-1 text-center text-sm font-semibold transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
      <TabPending />
    </Link>
  );
}
