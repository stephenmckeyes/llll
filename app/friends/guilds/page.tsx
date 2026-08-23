// ---------------------------------------------------------------------------
// /friends/guilds — CLOSED for now.
//
// Guilds are being reworked into certified groups responsible for creating
// adventures and (eventually) "achievement diaries". Until that ships the
// tab is hidden and this route redirects to /friends so old links/bookmarks
// don't land on a dead page. The full guild implementation (CommunityTab
// with kind="guild") is preserved in git history for when it returns.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

export default function GuildsClosedPage() {
  redirect("/friends");
}
