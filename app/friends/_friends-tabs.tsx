// ---------------------------------------------------------------------------
// FriendsTabs — the top-level tab switcher shared by /friends and its
// sibling routes /friends/groups, /friends/clubs, /friends/guilds.
//
// Same visual pattern as SectionTabs (which fronts Calendar / Streaks /
// Total on the Schedule surface). Four peers here — the "Friends" tab is
// the existing per-person view; the other three are community types
// (many groups / many clubs / many guilds per user, each with their own
// dropdown selector inside the tab).
//
// Kept in its own file so all four pages render the tab strip
// identically without dragging component state into the page bodies.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { TabPending } from "@/app/_components/tab-pending";

export type FriendsTabKind = "friends" | "groups" | "clubs" | "guilds";

export function FriendsTabs({ active }: { active: FriendsTabKind }) {
  return (
    <nav
      aria-label="Friends section"
      className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800"
    >
      <FriendsTab label="Friends" href="/friends" active={active === "friends"} />
      <FriendsTab label="Groups" href="/friends/groups" active={active === "groups"} />
      <FriendsTab label="Clubs" href="/friends/clubs" active={active === "clubs"} />
      <FriendsTab label="Guilds" href="/friends/guilds" active={active === "guilds"} />
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
