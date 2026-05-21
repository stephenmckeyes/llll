// ---------------------------------------------------------------------------
// SettingsShell — shared chrome for every sub-page under /settings/*.
//
// Provides:
//   - A consistent <main> container so width / padding match the index.
//   - A "← Settings" back-link so users can always return to the index
//     without using the browser back button.
//   - The section title rendered as the page <h1>.
//
// Pages embed their interactive content inside <SettingsShell>. iPhone-
// Settings-style: each sub-page has the same frame and a leading-back
// arrow.
// ---------------------------------------------------------------------------

import Link from "next/link";

export function SettingsShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <Link
          href="/settings"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Settings
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </header>
      {children}
    </main>
  );
}
