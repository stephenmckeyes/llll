// ---------------------------------------------------------------------------
// Supabase client for the *browser* side of Next.js (Client Components).
//
// Reads/writes cookies via document.cookie. The publishable key here is
// intended to be public — security comes from RLS policies on the DB.
// ---------------------------------------------------------------------------

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
