// ---------------------------------------------------------------------------
// Supabase session-refresh helper used from middleware.ts (at project root).
//
// Why this exists:
//   Supabase access tokens are short-lived. Without a middleware that
//   refreshes them on every request, the user's session would silently
//   expire mid-use. The @supabase/ssr docs are explicit: "Failing to
//   implement getAll/setAll correctly will cause significant and
//   difficult-to-debug authentication issues."
//
// The flow:
//   1. Read all incoming request cookies.
//   2. Hand them to a Supabase server client.
//   3. Call supabase.auth.getUser() — this triggers a token refresh if
//      the access token is close to expiry.
//   4. Any new cookies (refreshed access + refresh tokens) get written to
//      both the request (for downstream use this turn) and the response
//      (so the browser stores them).
// ---------------------------------------------------------------------------

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: don't run code between createServerClient and getUser.
  // Anything that touches Supabase here interferes with the cookie sync.
  await supabase.auth.getUser();

  return supabaseResponse;
}
