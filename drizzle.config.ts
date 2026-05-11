// Drizzle Kit config — tells the migration tool where to find the schema,
// where to write generated SQL migrations, and how to connect to the DB.
// Only used by the `drizzle-kit` CLI; never imported at runtime.

import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js convention puts the dev DB URL in .env.local (gitignored).
// dotenv's default only loads .env, so we explicitly load .env.local too.
loadEnv({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local — see .env.example."
  );
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Print every SQL statement Drizzle would run before running it.
  verbose: true,
  // Fail fast on ambiguous changes (e.g., column rename vs drop+add).
  strict: true,
});
