// ---------------------------------------------------------------------------
// MigrationCheckBanner — a red strip that renders on every page when a
// migration listed in `lib/db/schema-check.ts` hasn't been applied yet.
// Silent when the schema is caught up (returns null), so the banner is
// invisible under normal operation.
//
// Rationale: previously, forgetting to paste a migration silently
// returned empty data from SELECTs that referenced the missing column,
// which rendered every page as "you have nothing" and looked like a
// wiped account. This surfaces the actual problem by name.
// ---------------------------------------------------------------------------

import { getMissingMigrations } from "@/lib/db/schema-check";

export async function MigrationCheckBanner() {
  let missing: Awaited<ReturnType<typeof getMissingMigrations>> = [];
  try {
    missing = await getMissingMigrations();
  } catch {
    // Failure of the check itself must never break the page render.
    return null;
  }
  if (missing.length === 0) return null;

  return (
    <div
      role="alert"
      className="border-b-2 border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <div className="mx-auto max-w-2xl px-4 py-3">
        <p className="text-sm font-semibold">
          Database is behind the code — {missing.length}{" "}
          {missing.length === 1 ? "migration" : "migrations"} not applied
        </p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">
          {missing.map((m) => (
            <li key={m.migration} className="flex flex-wrap gap-x-2">
              <code className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-900 dark:bg-red-900/60 dark:text-red-100">
                lib/db/migrations/{m.migration}
              </code>
              <span className="text-xs text-red-800/90 dark:text-red-200/90">
                — {m.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-red-800/80 dark:text-red-200/80">
          Paste each in a fresh Supabase SQL tab. Data isn&rsquo;t lost —
          some new features can&rsquo;t load until the columns exist.
        </p>
      </div>
    </div>
  );
}
