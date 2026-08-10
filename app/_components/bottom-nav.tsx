"use client";

// ---------------------------------------------------------------------------
// BottomNav — persistent 5-slot bottom banner:
//   Settings · Friends · [Schedule] · Levels · Adventures
//                        ^ bigger, centered — represents Calendar / Streaks /
//                          Total (all live at "/" via SectionTabs).
//
// Rendered once at the layout level so every authed page shares it. Hidden
// on the auth pages (login / signup / onboarding) — there's nothing to
// navigate to yet.
//
// The component renders TWO nodes:
//   1. A non-fixed spacer that reserves the nav's height in normal flow, so
//      page content isn't clipped by the fixed bar.
//   2. The fixed nav itself, honoring iOS safe-area-inset-bottom.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";

// Routes where the nav should NOT show. Prefix match (so /login/whatever
// is still hidden). "/" and everything else is a match on the nav.
const HIDDEN_PREFIXES = ["/login", "/signup", "/onboarding"];

type NavItem = {
  label: string;
  href: string;
  match: (path: string) => boolean;
  icon: React.ReactNode;
  /** Bigger, centered emphasis (the Schedule slot). */
  primary?: boolean;
};

const ITEMS: NavItem[] = [
  {
    label: "Settings",
    href: "/settings",
    match: (p) => p.startsWith("/settings"),
    icon: <GearIcon />,
  },
  {
    label: "Friends",
    href: "/friends",
    match: (p) => p.startsWith("/friends"),
    icon: <FriendsIcon />,
  },
  {
    label: "Schedule",
    href: "/",
    // "Schedule" covers the three sub-sections (Calendar / Streaks live
    // at "/", Total lives at "/activities"). All three light up the
    // centered chip so the user always knows which top-level surface
    // they're in.
    match: (p) => p === "/" || p.startsWith("/activities"),
    icon: <ChecklistIcon />,
    primary: true,
  },
  {
    label: "Levels",
    href: "/levels",
    match: (p) => p.startsWith("/levels"),
    icon: <LevelsIcon />,
  },
  {
    label: "Adventures",
    href: "/adventures",
    match: (p) => p.startsWith("/adventures"),
    icon: <MountainIcon />,
  },
];

export function BottomNav() {
  const pathname = usePathname() ?? "/";
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <>
      {/* Spacer so the fixed bar doesn't cover the last row of any page.
          Matches the nav's height plus a bit of breathing room; safe-
          area is handled by padding inside the fixed nav. */}
      <div aria-hidden className="h-20" />
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex w-full max-w-2xl items-stretch justify-between px-2">
          {ITEMS.map((item) => (
            <li
              key={item.href}
              className={item.primary ? "flex-[1.6]" : "flex-1"}
            >
              <NavButton item={item} active={item.match(pathname)} />
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  const base =
    "group relative flex w-full flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors touch-manipulation";
  const size = item.primary ? "text-[11px]" : "text-[10px]";
  const color = active
    ? "text-zinc-900 dark:text-zinc-50"
    : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`${base} ${size} ${color}`}
    >
      <span
        className={`flex items-center justify-center ${
          item.primary ? "h-8 w-8" : "h-6 w-6"
        }`}
      >
        {item.icon}
      </span>
      <span className="leading-none">{item.label}</span>
      {/* Active pill above the icon. */}
      {active && (
        <span
          aria-hidden
          className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-full bg-zinc-900 dark:bg-zinc-50"
        />
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVG so they inherit currentColor and don't add a network
// hop. All use viewBox 0 0 24 24 with stroke-based drawing so they look
// crisp at any size the nav ever renders them.
// ---------------------------------------------------------------------------

function svgProps() {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-full w-full",
    "aria-hidden": true,
  };
}

function GearIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FriendsIcon() {
  // Three silhouettes: two heads with shoulders + a smaller one behind.
  return (
    <svg {...svgProps()}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.25" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M15 20c0-2.4 1.6-4 3.5-4S22 17.6 22 20" />
    </svg>
  );
}

function ChecklistIcon() {
  // Clipboard with checked lines.
  return (
    <svg {...svgProps()}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z" />
      <path d="M8.5 11l1.5 1.5 3-3" />
      <path d="M13 11h4" />
      <path d="M8.5 16l1.5 1.5 3-3" />
      <path d="M13 16h4" />
    </svg>
  );
}

function LevelsIcon() {
  // Ascending bar chart — three bars increasing L→R.
  return (
    <svg {...svgProps()}>
      <rect x="4" y="14" width="4" height="6" rx="0.5" />
      <rect x="10" y="10" width="4" height="10" rx="0.5" />
      <rect x="16" y="5" width="4" height="15" rx="0.5" />
    </svg>
  );
}

function MountainIcon() {
  // Two-peak mountain with a small sun.
  return (
    <svg {...svgProps()}>
      <circle cx="17" cy="7" r="1.5" />
      <path d="M3 20l5-8 4 5 3-4 6 7z" />
    </svg>
  );
}
