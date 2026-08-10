// ---------------------------------------------------------------------------
// Calendar filter — shared helpers for the "hide by tag" affordance on
// the Calendar section (Day / Week / Month / Year / Timeline).
//
// URL contract: `?hideTags=tag1,tag2` — comma-separated list of tag
// NAMES to hide. Absent or empty = no filter. The special value
// `?hideTags=none` explicitly means "cleared" (differentiates from "no
// param" so we don't apply the profile default when the user has
// intentionally cleared).
//
// Cold-open handling lives in app/page.tsx: when the URL has no
// `?hideTags` at all (which is the state right after cold-open strips
// query params), the page reads profile.default_calendar_hidden_tags
// as the initial filter.
// ---------------------------------------------------------------------------

/** Serialize a tag-hide list into the value of ?hideTags. */
export function serializeHideTags(tags: readonly string[]): string {
  const cleaned = Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)));
  if (cleaned.length === 0) return "none";
  return cleaned.join(",");
}

/** Parse the raw URL value into a normalized set (empty when none). */
export function parseHideTags(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  if (raw === "none") return new Set();
  return new Set(
    raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

/**
 * Filter predicate — returns true when the row should be KEPT.
 * A row is hidden when it shares any tag with the hidden set.
 */
export function keepForCalendar(
  activityTags: readonly string[],
  hidden: ReadonlySet<string>
): boolean {
  if (hidden.size === 0) return true;
  for (const t of activityTags) if (hidden.has(t)) return false;
  return true;
}
