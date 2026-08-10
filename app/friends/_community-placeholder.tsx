// ---------------------------------------------------------------------------
// CommunityPlaceholder — shared shell for /friends/groups, /friends/clubs,
// and /friends/guilds. Each of those routes just points here with a
// different `kind` + copy block. When the real feature lands (see
// BACKLOG.md → "Communities (Groups / Clubs / Guilds)") this file gets
// replaced by the real dropdown + create modal + overall / calendar /
// leadership views, and the tab pages start passing real props.
//
// Kept in its own file so all three tabs are visually identical while
// they're empty — same header, same empty state, same "coming soon"
// treatment. Reads its bullet list from the caller so per-type nuances
// still show through.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

export function CommunityPlaceholder({
  title,
  tagline,
  whatItIs,
  planned,
}: {
  title: string;
  tagline: string;
  /** Short "what a X is" description for the top card. */
  whatItIs: ReactNode;
  /** Feature bullets that WILL land here — mirrors the spec captured
   *  in BACKLOG.md. Helps users see the shape without opening the
   *  backlog. */
  planned: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Disabled + New button — mirrors the shape of the eventual
          top-of-tab affordance so the layout doesn't jump when the
          real feature lands. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="truncate text-xs text-zinc-500">{tagline}</p>
        </div>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="inline-flex shrink-0 cursor-not-allowed items-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
        >
          + New
        </button>
      </div>

      <div className="rounded-md border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
        <p className="font-medium text-zinc-800 dark:text-zinc-100">
          {title} are coming soon.
        </p>
        <div className="mt-2 text-zinc-600 dark:text-zinc-400">{whatItIs}</div>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Planned
        </h3>
        <ul className="flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300">
          {planned.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-zinc-400">
                ·
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
