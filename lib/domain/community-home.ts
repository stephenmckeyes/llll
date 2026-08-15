// ---------------------------------------------------------------------------
// Community home page — customizable widget layout.
//
// Leadership composes a community's Home tab from "widgets" (a description /
// text block, a list of upcoming activities, an image, the member roster,
// …), each sized to fill the page. The layout is stored as a jsonb array on
// `communities.home_layout`; a separate `home_fit_one_page` flag chooses
// between "fit everything on one screen" (no scroll) and "scroll for more".
//
// This module is the single source of truth for the widget shapes + safe
// normalization of whatever is in the DB (defends against hand-edited / old
// jsonb) so the renderer and editor never see garbage.
// ---------------------------------------------------------------------------

/** Widget width on the 2-column home grid. "full" spans both columns. */
export type HomeWidgetWidth = "half" | "full";

export type HomeWidgetType = "text" | "activities" | "image" | "members";

type Base = { id: string; width: HomeWidgetWidth };

export type HomeWidget =
  | (Base & { type: "text"; title?: string; body: string })
  | (Base & { type: "activities"; title?: string; count: number })
  | (Base & { type: "image"; url: string; caption?: string })
  | (Base & { type: "members"; title?: string });

export type HomeLayout = HomeWidget[];

// Guardrails so a hand-edited / runaway layout can't blow up the page.
export const MAX_HOME_WIDGETS = 24;
const MAX_TEXT = 8000;
const MAX_TITLE = 120;
const MAX_URL = 4000;
const MAX_CAPTION = 200;

export const HOME_WIDGET_META: Record<
  HomeWidgetType,
  { label: string; help: string }
> = {
  text: { label: "Text", help: "A heading + paragraph — description, rules, links." },
  activities: {
    label: "Upcoming activities",
    help: "The next few of the community's scheduled activities.",
  },
  image: { label: "Image", help: "A picture by URL (with an optional caption)." },
  members: { label: "Members", help: "The member roster + count." },
};

export const HOME_WIDGET_TYPES: HomeWidgetType[] = [
  "text",
  "activities",
  "image",
  "members",
];

function clampStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function coerceWidth(v: unknown): HomeWidgetWidth {
  return v === "full" ? "full" : "half";
}

// A fresh widget of the given type, with sensible defaults. `id` is supplied
// by the caller (client uses crypto.randomUUID()).
export function newHomeWidget(type: HomeWidgetType, id: string): HomeWidget {
  switch (type) {
    case "text":
      return { id, type, width: "full", title: "", body: "" };
    case "activities":
      return { id, type, width: "full", title: "Upcoming", count: 5 };
    case "image":
      return { id, type, width: "half", url: "", caption: "" };
    case "members":
      return { id, type, width: "full", title: "Members" };
  }
}

// Turn arbitrary jsonb (or null) into a valid HomeLayout, dropping anything
// malformed. Never throws.
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  if (!Array.isArray(raw)) return [];
  const out: HomeLayout = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id.length > 0 ? r.id : null;
    if (!id) continue;
    const width = coerceWidth(r.width);
    switch (r.type) {
      case "text":
        out.push({
          id,
          type: "text",
          width,
          title: clampStr(r.title, MAX_TITLE),
          body: clampStr(r.body, MAX_TEXT),
        });
        break;
      case "activities": {
        const n = Math.round(Number(r.count));
        out.push({
          id,
          type: "activities",
          width,
          title: clampStr(r.title, MAX_TITLE),
          count: Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : 5,
        });
        break;
      }
      case "image":
        out.push({
          id,
          type: "image",
          width,
          url: clampStr(r.url, MAX_URL),
          caption: clampStr(r.caption, MAX_CAPTION),
        });
        break;
      case "members":
        out.push({
          id,
          type: "members",
          width,
          title: clampStr(r.title, MAX_TITLE),
        });
        break;
      default:
        break;
    }
    if (out.length >= MAX_HOME_WIDGETS) break;
  }
  return out;
}
