// ---------------------------------------------------------------------------
// Next.js middleware — runs before every matching request.
// Its only job: refresh the Supabase session cookie so the user stays
// logged in seamlessly. All the heavy lifting is in lib/supabase/middleware.
// ---------------------------------------------------------------------------

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
