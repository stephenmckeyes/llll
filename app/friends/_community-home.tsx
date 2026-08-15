"use client";

// ---------------------------------------------------------------------------
// Community Home widgets — renderer + leadership editor (migration 0064).
//
// Leadership composes the Home tab from sized widgets (text / upcoming
// activities / image) on a 2-column grid, and picks fit-one-page vs scroll.
// The renderer is read-only for everyone; the editor is gated by
// can_edit_settings at the call site (and server-side in the RPC).
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setCommunityHomeLayout, type CommunityDetail } from "@/app/actions/communities";
import {
  HOME_WIDGET_META,
  MAX_HOME_WIDGETS,
  newHomeWidget,
  type HomeLayout,
  type HomeWidget,
  type HomeWidgetType,
} from "@/lib/domain/community-home";

// Types offered in the editor's "add" menu. "members" exists in the model
// but the Home tab already has a dedicated Members section, so it isn't
// offered here to avoid duplication.
const ADDABLE_TYPES: HomeWidgetType[] = ["text", "activities", "image"];

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function CommunityHomeWidgets({ detail }: { detail: CommunityDetail }) {
  const layout = detail.homeLayout;

  // Legacy fallback: no widgets yet but the old free-text home exists.
  if (layout.length === 0) {
    if (detail.homeContent) {
      return (
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {detail.homeContent}
        </p>
      );
    }
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {detail.myPermissions.can_edit_settings
          ? "No home page yet — tap Edit to add widgets."
          : "No home page yet."}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {layout.map((w) => (
        <div
          key={w.id}
          className={w.width === "full" ? "col-span-2" : "col-span-2 sm:col-span-1"}
        >
          <WidgetView widget={w} detail={detail} />
        </div>
      ))}
    </div>
  );
}

function WidgetView({
  widget,
  detail,
}: {
  widget: HomeWidget;
  detail: CommunityDetail;
}) {
  if (widget.type === "text") {
    return (
      <div className="flex h-full flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        {widget.title && (
          <h4 className="text-sm font-semibold">{widget.title}</h4>
        )}
        {widget.body && (
          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {widget.body}
          </p>
        )}
      </div>
    );
  }

  if (widget.type === "image") {
    if (!widget.url) return null;
    return (
      <figure className="flex h-full flex-col gap-1 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={widget.url}
          alt={widget.caption || "Community image"}
          className="max-h-64 w-full object-cover"
        />
        {widget.caption && (
          <figcaption className="px-3 pb-2 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {widget.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  if (widget.type === "members") {
    return (
      <div className="flex h-full flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <h4 className="text-sm font-semibold">
          {widget.title || "Members"} ({detail.memberCount})
        </h4>
        <ul className="flex flex-col gap-0.5 text-sm text-zinc-700 dark:text-zinc-300">
          {detail.members.map((m) => (
            <li key={m.userId} className="truncate">
              {m.displayName || m.username || "Member"}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // activities
  const items = detail.upcoming.slice(0, widget.count);
  return (
    <div className="flex h-full flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <h4 className="text-sm font-semibold">{widget.title || "Upcoming"}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No upcoming activities.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li
              key={`${it.activityId}:${it.scheduledFor}:${i}`}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="truncate text-zinc-700 dark:text-zinc-300">
                {it.name}
              </span>
              <span className="shrink-0 text-xs text-zinc-500">
                {formatDay(it.scheduledFor)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function CommunityHomeEditor({
  detail,
  onClose,
}: {
  detail: CommunityDetail;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fit, setFit] = useState(detail.homeFitOnePage);
  // Seed from the saved layout, or a text widget from the legacy home text.
  const [widgets, setWidgets] = useState<HomeLayout>(() => {
    if (detail.homeLayout.length > 0) return detail.homeLayout;
    if (detail.homeContent) {
      return [
        {
          id: makeId(),
          type: "text",
          width: "full",
          title: "",
          body: detail.homeContent,
        },
      ];
    }
    return [];
  });

  function update(id: string, patch: Partial<HomeWidget>) {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? ({ ...w, ...patch } as HomeWidget) : w))
    );
  }
  function add(type: HomeWidgetType) {
    if (widgets.length >= MAX_HOME_WIDGETS) return;
    setWidgets((prev) => [...prev, newHomeWidget(type, makeId())]);
  }
  function remove(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    setWidgets((prev) => {
      const i = prev.findIndex((w) => w.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setCommunityHomeLayout(detail.id, widgets, fit);
      if ("error" in res) setError(res.error);
      else {
        onClose();
        router.refresh();
      }
    });
  }

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="flex flex-col gap-3">
      {/* Page-fit toggle */}
      <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <span className="text-xs font-medium text-zinc-500">Page size</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setFit(true)}
            aria-pressed={fit}
            className={toggleCls(fit)}
          >
            Fit one page
          </button>
          <button
            type="button"
            onClick={() => setFit(false)}
            aria-pressed={!fit}
            className={toggleCls(!fit)}
          >
            Scroll for more
          </button>
        </div>
        <p className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
          Fit keeps Home to a single screen (extra content is clipped). Scroll
          lets the page grow as long as you like.
        </p>
      </div>

      {widgets.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No widgets yet — add one below.
        </p>
      )}

      {widgets.map((w, i) => (
        <div
          key={w.id}
          className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {HOME_WIDGET_META[w.type].label}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(w.id, -1)}
                disabled={i === 0}
                aria-label="Move up"
                className={miniBtn}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(w.id, 1)}
                disabled={i === widgets.length - 1}
                aria-label="Move down"
                className={miniBtn}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(w.id)}
                aria-label="Remove widget"
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-zinc-700 dark:text-red-400 dark:hover:bg-red-950"
              >
                Remove
              </button>
            </div>
          </div>

          {/* Width */}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => update(w.id, { width: "half" })}
              aria-pressed={w.width === "half"}
              className={`flex-1 ${toggleCls(w.width === "half")}`}
            >
              Half width
            </button>
            <button
              type="button"
              onClick={() => update(w.id, { width: "full" })}
              aria-pressed={w.width === "full"}
              className={`flex-1 ${toggleCls(w.width === "full")}`}
            >
              Full width
            </button>
          </div>

          {/* Type-specific fields */}
          {w.type === "text" && (
            <>
              <input
                type="text"
                value={w.title ?? ""}
                onChange={(e) => update(w.id, { title: e.target.value })}
                maxLength={120}
                placeholder="Title (optional)"
                className={inputCls}
              />
              <textarea
                value={w.body}
                onChange={(e) => update(w.id, { body: e.target.value })}
                rows={4}
                maxLength={8000}
                placeholder="Text — description, rules, links…"
                className={`${inputCls} resize-y`}
              />
            </>
          )}
          {w.type === "activities" && (
            <>
              <input
                type="text"
                value={w.title ?? ""}
                onChange={(e) => update(w.id, { title: e.target.value })}
                maxLength={120}
                placeholder="Title (e.g. Upcoming)"
                className={inputCls}
              />
              <label className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500">Show</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={w.count}
                  onChange={(e) =>
                    update(w.id, {
                      count: Math.min(
                        Math.max(parseInt(e.target.value, 10) || 1, 1),
                        20
                      ),
                    })
                  }
                  className={`${inputCls} w-20`}
                />
                <span className="text-zinc-500">activities</span>
              </label>
            </>
          )}
          {w.type === "image" && (
            <>
              <input
                type="url"
                value={w.url}
                onChange={(e) => update(w.id, { url: e.target.value })}
                maxLength={4000}
                placeholder="Image URL (https://…)"
                className={inputCls}
              />
              <input
                type="text"
                value={w.caption ?? ""}
                onChange={(e) => update(w.id, { caption: e.target.value })}
                maxLength={200}
                placeholder="Caption (optional)"
                className={inputCls}
              />
              {w.url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={w.url}
                  alt="Preview"
                  className="max-h-40 w-full rounded-md object-cover"
                />
              )}
            </>
          )}
          {w.type === "members" && (
            <input
              type="text"
              value={w.title ?? ""}
              onChange={(e) => update(w.id, { title: e.target.value })}
              maxLength={120}
              placeholder="Title (e.g. Members)"
              className={inputCls}
            />
          )}
        </div>
      ))}

      {/* Add widget */}
      {widgets.length < MAX_HOME_WIDGETS && (
        <div className="flex flex-col gap-1 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
          <span className="text-xs font-medium text-zinc-500">Add widget</span>
          <div className="flex flex-wrap gap-1">
            {ADDABLE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => add(t)}
                title={HOME_WIDGET_META[t].help}
                className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                + {HOME_WIDGET_META[t].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Saving…" : "Save home"}
        </button>
      </div>
    </div>
  );
}

const miniBtn =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900";

function toggleCls(active: boolean): string {
  return `touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
    active
      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
  }`;
}

// Stable-ish unique id for a new widget (browser crypto when available).
function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `w-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}
