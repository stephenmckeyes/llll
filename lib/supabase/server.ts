// ---------------------------------------------------------------------------
// Supabase client for the *server* side of Next.js
// (Server Components, Server Actions, Route Handlers).
//
// IMPORTANT — Next.js 16:
//   - `cookies()` is async and MUST be awaited.
//   - Cookie .set() can throw if called during Server Component rendering;
//     middleware.ts is responsible for actually persisting refreshed
//     tokens to the response, so we swallow the error here.
//
// Always create a NEW client per request — never reuse across requests.
// ---------------------------------------------------------------------------

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore.
            // Middleware will refresh the token and set the cookie.
          }
        },
      },
    }
  );
}
