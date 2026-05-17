// ---------------------------------------------------------------------------
// Next.js proxy — runs before every matching request. (Next 16 renamed the
// `middleware` file convention to `proxy`. The contract is the same: a
// single exported function that returns a Response, with an optional config
// matcher.)
//
// Its only job: refresh the Supabase session cookie so the user stays
// logged in seamlessly. All the heavy lifting is in lib/supabase/middleware,
// which is just internal naming — that helper still exists and works fine.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip:
     *   - Next.js internals (_next/static, _next/image)
     *   - The favicon
     *   - Common static file extensions
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
