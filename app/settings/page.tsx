// ---------------------------------------------------------------------------
// /settings — the Settings index.
//
// iPhone-Settings-style: a list of link tiles, each leading to its own
// focused sub-page. The actual configurable bits (theme, export, TZ,
// account) all live under /settings/<name>. This page is just the
// chooser.
//
// Sign-out lives at the very bottom (per user spec — not the first
// thing the user sees).
// ---------------------------------------------------------------------------

import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

type TileItem = {
  href: string;
  label: string;
  hint: string;
};

const TILES: TileItem[] = [
  {
    href: "/settings/account",
    label: "Account",
    hint: "Email, password, display name.",
  },
  {
    href: "/settings/timezone",
    label: "Timezone",
    hint: "Anchor your day at the right TZ.",
  },
  {
    href: "/settings/appearance",
    label: "Appearance",
    hint: "Light, dark, sleep mode.",
  },
  {
    href: "/settings/data",
    label: "Data",
    hint: "Export your activities as JSON.",
  },
];

export default async function SettingsPage() {
  // Auth + onboarded gate. We don't need the user/profile here (each
  // sub-page fetches what it needs), but bouncing unauthed visitors is
  // still required.
  await requireOnboardedUser();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header>
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Settings
        </h1>
      </header>

      <ul className="flex flex-col gap-2">
        {TILES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium">{t.label}</span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.hint}
                </span>
              </span>
              <span
                aria-hidden
                className="text-lg leading-none text-zinc-400 dark:text-zinc-600"
              >
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Sign-out at the very bottom — keeps it out of the "primary
          actions" lane visually, but still one click away. */}
      <section className="mt-auto flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Session
        </h2>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
