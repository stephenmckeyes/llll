// ---------------------------------------------------------------------------
// Migration runner — applies the raw-SQL migrations in lib/db/migrations/*.sql
// directly to the database in DATABASE_URL (.env.local), so you never have to
// copy/paste SQL into the Supabase dashboard again.
//
// Why a custom runner (not `drizzle-kit migrate`): this project writes
// hand-authored `--custom` SQL migrations (0001_*.sql … ) and the Drizzle
// snapshot metadata is intentionally out of sync (see BACKLOG "Known quirks"),
// so drizzle-kit can't be trusted to apply them. This runner just plays the
// .sql files in filename order and records which ones it has run in a
// `public._applied_migrations` table IN THE DATABASE — so two machines sharing
// one Supabase project automatically agree on what's applied.
//
// Usage:
//   node scripts/migrate.mjs                 # apply every pending migration
//   npm run db:apply                         # (same, via package.json)
//
//   # ONE-TIME setup on a DB that already has migrations applied by hand:
//   npm run db:apply -- --baseline-to=0082   # mark 0001..0082 as applied
//                                            # WITHOUT running them, then a
//                                            # normal `npm run db:apply`
//                                            # runs 0083+ onward.
//   npm run db:apply -- --baseline           # mark ALL current files applied
//                                            # (use when the DB already has
//                                            # every migration).
//
// A fresh/empty database needs no baseline — just `npm run db:apply` plays
// everything from 0001.
//
// Safety: each file is recorded only after it succeeds; on an error the runner
// stops and exits non-zero. Most migrations here are written idempotently
// (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE), so a re-run is
// safe — but SEED migrations (fake data) are not, which is exactly why the
// baseline flags exist for an already-populated DB.
// ---------------------------------------------------------------------------

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { config as loadEnv } from "dotenv";
import postgres from "postgres";

// Next.js convention: the DB URL lives in .env.local (gitignored). Load it
// first, then fall back to .env for anything not overridden.
loadEnv({ path: ".env.local" });
loadEnv();

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error(
    "DATABASE_URL is not set. Add it to .env.local (Supabase → Project " +
      "Settings → Database → Connection string). See .env.example."
  );
  process.exit(1);
}

// Optional: supply the DB password as its OWN value so special characters
// (@ : / # ? & …) don't have to be percent-encoded inside the URL — a very
// common cause of "password authentication failed". Keep the full Supabase URI
// in DATABASE_URL (even with its [YOUR-PASSWORD] placeholder) and put the raw
// password in DATABASE_PASSWORD; it's injected (URL-encoded) here.
const rawPassword = process.env.DATABASE_PASSWORD;
let url = rawUrl;
if (rawPassword) {
  const enc = encodeURIComponent(rawPassword);
  // userinfo already has a password slot: scheme://user:SOMETHING@host
  const withPw = rawUrl.replace(
    /^(\w+(?::\w+)?:\/\/[^:@/?#]+:)[^@]*(@)/,
    `$1${enc}$2`
  );
  // or userinfo has only a user: scheme://user@host  → insert a password
  url =
    withPw !== rawUrl
      ? withPw
      : rawUrl.replace(/^(\w+(?::\w+)?:\/\/[^:@/?#]+)(@)/, `$1:${enc}$2`);
}

// Print the user + host it will try (never the password) — makes a 28P01
// "wrong user/password" mistake obvious.
try {
  const u = new URL(url);
  console.log(
    `Connecting as user "${decodeURIComponent(u.username)}" to ${u.host}${
      rawPassword ? " (password from DATABASE_PASSWORD)" : ""
    }`
  );
} catch {
  /* URL may be unparseable if a raw password slipped into DATABASE_URL — the
     connection attempt below will still surface the real error. */
}

// --- flags ---------------------------------------------------------------
const args = process.argv.slice(2);
const baselineAll = args.includes("--baseline");
const baselineToArg = args.find((a) => a.startsWith("--baseline-to"));
// Accept --baseline-to=0082 or --baseline-to 0082.
const baselineTo = baselineToArg
  ? (baselineToArg.includes("=")
      ? baselineToArg.split("=")[1]
      : args[args.indexOf(baselineToArg) + 1]) ?? ""
  : null;

const MIGRATIONS_DIR = path.resolve("lib/db/migrations");
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

const sql = postgres(url, {
  max: 1,
  // Supabase's transaction pooler (port 6543) doesn't support prepared
  // statements; direct/session connections are fine either way.
  prepare: false,
  // Supabase requires TLS for non-local connections. A local Postgres doesn't.
  ssl: isLocal ? false : "require",
  // Keep NOTICE spam (RAISE NOTICE, "already exists", etc.) out of the output.
  onnotice: () => {},
});

// Normalize "0082" / "82" / "0082_activity_goals.sql" → the 4-digit prefix.
function prefixOf(nameOrNum) {
  const m = String(nameOrNum).match(/(\d{1,4})/);
  return m ? m[1].padStart(4, "0") : null;
}

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS public._applied_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const appliedRows = await sql`SELECT name FROM public._applied_migrations`;
  const applied = new Set(appliedRows.map((r) => r.name));
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("✓ No pending migrations — database is up to date.");
    return;
  }

  // --- Baseline modes: record as applied WITHOUT executing ---------------
  if (baselineAll || baselineTo !== null) {
    const cutoff = baselineTo !== null ? prefixOf(baselineTo) : null;
    if (baselineTo !== null && !cutoff) {
      console.error(
        `--baseline-to needs a migration number, e.g. --baseline-to=0082`
      );
      process.exit(1);
    }
    const toMark = baselineAll
      ? pending
      : pending.filter((f) => (prefixOf(f) ?? "9999") <= cutoff);
    for (const f of toMark) {
      await sql`
        INSERT INTO public._applied_migrations (name) VALUES (${f})
        ON CONFLICT (name) DO NOTHING
      `;
    }
    console.log(
      `✓ Baselined ${toMark.length} migration(s) as already-applied (no SQL run).` +
        (baselineTo !== null ? ` Up to ${cutoff}.` : "")
    );
    const stillPending = pending.length - toMark.length;
    if (stillPending > 0) {
      console.log(
        `  ${stillPending} newer migration(s) remain — run "npm run db:apply" to apply them.`
      );
    }
    return;
  }

  // --- Normal mode: run each pending file in order -----------------------
  console.log(`Applying ${pending.length} pending migration(s)…`);
  for (const f of pending) {
    const content = await readFile(path.join(MIGRATIONS_DIR, f), "utf8");
    process.stdout.write(`  → ${f} … `);
    try {
      // .simple() runs the whole file in one round-trip using the simple
      // query protocol, which allows multiple statements (no bind params).
      await sql.unsafe(content).simple();
      await sql`
        INSERT INTO public._applied_migrations (name) VALUES (${f})
        ON CONFLICT (name) DO NOTHING
      `;
      console.log("done");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${f} failed:\n${err?.message ?? err}\n`);
      console.error(
        "Nothing after this point was applied. Fix the SQL (or baseline past " +
          "an already-applied file) and re-run."
      );
      process.exit(1);
    }
  }
  console.log(`✓ Applied ${pending.length} migration(s).`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    if (err?.code === "28P01") {
      console.error(
        "\npassword authentication failed (28P01). Check in .env.local:\n" +
          "  • the password is correct (reset it: Supabase → Settings → " +
          "Database → Reset database password), and\n" +
          "  • the USERNAME matches the host — a '...pooler.supabase.com' host " +
          "needs user 'postgres.<project-ref>', while the direct " +
          "'db.<ref>.supabase.co' host uses just 'postgres'.\n" +
          "  • if the password has symbols, put it in DATABASE_PASSWORD instead " +
          "of inside the URL (see .env.example)."
      );
    } else {
      console.error(err);
    }
    await sql.end();
    process.exit(1);
  });
