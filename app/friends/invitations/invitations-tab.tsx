"use client";

// ---------------------------------------------------------------------------
// InvitationsTab — browse / filter / post invitations (migration 0084).
//
// - List of every invitation the viewer can see (RLS + get_available_
//   invitations), filtered client-side (search, source, community, skill,
//   tag, date range, distance) and sorted (soonest / nearest / newest).
// - "Use my location" asks the browser for coordinates and re-queries so
//   distance shows + Nearby-only invitations within range appear. The
//   coordinates are only sent with that query — never stored.
// - "+ New invitation" opens the shared ActivityFormFields plus the
//   invitation-only fields (host, audience, location, radius, skill, spots).
// - "Add to my calendar" copies it onto the viewer's calendar with their
//   reminders (RSVP); "Leave" undoes that.
// ---------------------------------------------------------------------------

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  addInvitationToCalendarFormAction,
  cancelInvitation,
  createInvitationFormAction,
  getAvailableInvitations,
  getInvitationAttendees,
  leaveInvitation,
  updateInvitationFormAction,
} from "@/app/actions/invitations";
import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import { RemindersField } from "@/app/_components/reminders-field";
import { Segmented } from "@/app/_components/segmented";
import { TagChip } from "@/app/_components/tag-chip";
import {
  AUDIENCE_LABEL,
  DEFAULT_INVITATION_FILTERS,
  SKILL_LABEL,
  SKILL_LEVELS,
  filterInvitations,
  formatDistance,
  type Invitation,
  type InvitationAudience,
  type InvitationCommunity,
  type InvitationFilters,
  type InvitationSource,
  type SkillLevel,
} from "@/lib/domain/invitations";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";
import type { Reminder } from "@/lib/validators/reminder";

const LOCATION_PREF_KEY = "mission.invitations.useLocation";

const inputCls =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50";
const smallBtn =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const primaryBtn =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300";

type Coords = { lat: number; lng: number };
type SortKey = "soonest" | "nearest" | "newest";

function getBrowserCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location isn't available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied."
              : "Couldn't get your location."
          )
        ),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

export function InvitationsTab({
  viewerId,
  initialInvitations,
  communities,
  tagMap,
}: {
  viewerId: string;
  initialInvitations: Invitation[];
  communities: InvitationCommunity[];
  tagMap: TagMap;
}) {
  const router = useRouter();
  const [coords, setCoords] = useState<Coords | null>(null);
  const [located, setLocated] = useState<Invitation[] | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [filters, setFilters] = useState<InvitationFilters>(DEFAULT_INVITATION_FILTERS);
  const [sort, setSort] = useState<SortKey>("soonest");
  const [showFilters, setShowFilters] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Invitation | null>(null);
  const [joining, setJoining] = useState<Invitation | null>(null);

  // Server data is the source of truth; when location is on, the located
  // re-query (which includes distance + in-range Nearby invitations) wins.
  const invitations = located ?? initialInvitations;

  async function enableLocation() {
    setLocError(null);
    setLocating(true);
    try {
      const c = await getBrowserCoords();
      setCoords(c);
      setLocated(await getAvailableInvitations(c));
      try {
        localStorage.setItem(LOCATION_PREF_KEY, "1");
      } catch {}
    } catch (e) {
      setLocError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }
  function disableLocation() {
    setCoords(null);
    setLocated(null);
    setFilters((f) => ({ ...f, maxDistanceKm: null }));
    if (sort === "nearest") setSort("soonest");
    try {
      localStorage.removeItem(LOCATION_PREF_KEY);
    } catch {}
  }

  // Remembered opt-in: re-locate on mount.
  useEffect(() => {
    let want = false;
    try {
      want = localStorage.getItem(LOCATION_PREF_KEY) === "1";
    } catch {}
    if (!want) return;
    // Deferred so the re-locate's state updates happen outside the effect body.
    const t = setTimeout(() => void enableLocation(), 0);
    return () => clearTimeout(t);
  }, []);

  // After a mutation: refresh the server list, and the located copy if on.
  async function refreshAll() {
    router.refresh();
    if (coords) setLocated(await getAvailableInvitations(coords));
  }

  const allTags = useMemo(
    () => Array.from(new Set(invitations.flatMap((i) => i.tags))).sort(),
    [invitations]
  );

  const shown = useMemo(() => {
    const list = filterInvitations(invitations, filters, viewerId);
    const sorted = [...list];
    if (sort === "nearest") {
      sorted.sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
      );
    } else if (sort === "newest") {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      sorted.sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          (a.scheduledTimes[0] ?? "").localeCompare(b.scheduledTimes[0] ?? "")
      );
    }
    return sorted;
  }, [invitations, filters, sort, viewerId]);

  const activeFilterCount =
    (filters.communityId ? 1 : 0) +
    (filters.skill !== "any" ? 1 : 0) +
    (filters.tag ? 1 : 0) +
    (filters.from ? 1 : 0) +
    (filters.to ? 1 : 0) +
    (filters.maxDistanceKm !== null ? 1 : 0);

  const sourceOptions: ReadonlyArray<readonly [InvitationSource, string]> = [
    ["all", "All"],
    ["going", "Going"],
    ["mine", "Mine"],
    ["friends", "Friends"],
    ["communities", "Communities"],
    ["nearby", "Nearby"],
    ["public", "Anyone"],
  ];

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Invitations</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`${primaryBtn} shrink-0`}
          >
            + New invitation
          </button>
        </div>
        <p className="text-sm text-zinc-500">
          Join activities from friends, your communities, and people nearby.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="Search name, place, host, tag…"
          className={inputCls}
          aria-label="Search invitations"
        />
        <div className="flex gap-1 overflow-x-auto pb-1">
          {sourceOptions.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, source: v }))}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filters.source === v
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={smallBtn}
            aria-expanded={showFilters}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {coords ? (
            <button type="button" onClick={disableLocation} className={smallBtn}>
              📍 Location on · turn off
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void enableLocation()}
              disabled={locating}
              className={smallBtn}
            >
              {locating ? "Locating…" : "📍 Use my location"}
            </button>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="ml-auto rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            aria-label="Sort invitations"
          >
            <option value="soonest">Soonest</option>
            {coords && <option value="nearest">Nearest</option>}
            <option value="newest">Newest</option>
          </select>
        </div>
        {locError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {locError}
          </p>
        )}
        {showFilters && (
          <FiltersPanel
            filters={filters}
            setFilters={setFilters}
            communities={communities}
            tags={allTags}
            hasLocation={coords !== null}
          />
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {invitations.length === 0
            ? "No invitations yet. Post one to invite friends, a community, or people nearby."
            : "No invitations match these filters."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((inv) => (
            <InvitationCard
              key={inv.id}
              inv={inv}
              tagMap={tagMap}
              onJoin={() => setJoining(inv)}
              onEdit={() => setEditing(inv)}
              onChanged={() => void refreshAll()}
            />
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <InvitationFormModal
          existing={editing}
          communities={communities}
          tagMap={tagMap}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void refreshAll();
          }}
        />
      )}

      {joining && (
        <AddToCalendarModal
          inv={joining}
          onClose={() => setJoining(null)}
          onDone={() => {
            setJoining(null);
            void refreshAll();
          }}
        />
      )}
    </div>
  );
}

// --- filters -----------------------------------------------------------------

function FiltersPanel({
  filters,
  setFilters,
  communities,
  tags,
  hasLocation,
}: {
  filters: InvitationFilters;
  setFilters: React.Dispatch<React.SetStateAction<InvitationFilters>>;
  communities: InvitationCommunity[];
  tags: string[];
  hasLocation: boolean;
}) {
  const selCls =
    "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      {communities.length > 0 && (
        <label className="col-span-2 flex flex-col gap-1 text-xs text-zinc-500">
          Community
          <select
            value={filters.communityId}
            onChange={(e) => setFilters((f) => ({ ...f, communityId: e.target.value }))}
            className={selCls}
          >
            <option value="">Any</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Skill level
        <select
          value={filters.skill}
          onChange={(e) =>
            setFilters((f) => ({ ...f, skill: e.target.value as SkillLevel | "any" }))
          }
          className={selCls}
        >
          <option value="any">Any</option>
          {SKILL_LEVELS.filter((s) => s !== "all").map((s) => (
            <option key={s} value={s}>
              {SKILL_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        Tag
        <select
          value={filters.tag}
          onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
          className={selCls}
        >
          <option value="">Any</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        From
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          className={selCls}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        To
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          className={selCls}
        />
      </label>
      <label className="col-span-2 flex flex-col gap-1 text-xs text-zinc-500">
        Distance
        <select
          value={filters.maxDistanceKm ?? ""}
          disabled={!hasLocation}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              maxDistanceKm: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
          className={selCls}
        >
          <option value="">{hasLocation ? "Any distance" : "Turn on location to filter by distance"}</option>
          {[2, 5, 10, 25, 50, 100, 250].map((km) => (
            <option key={km} value={km}>
              Within {km} km
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() =>
          setFilters((f) => ({ ...DEFAULT_INVITATION_FILTERS, query: f.query, source: f.source }))
        }
        className={`${smallBtn} col-span-2 justify-self-start`}
      >
        Clear filters
      </button>
    </div>
  );
}

// --- card --------------------------------------------------------------------

function formatDate(d: string): string {
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function whenLabel(inv: Invitation): string {
  if (inv.rhythm.type === "single") {
    if (inv.endDate && inv.endDate > inv.startDate) {
      return `${formatDate(inv.startDate)} – ${formatDate(inv.endDate)}`;
    }
    return formatDate(inv.startDate);
  }
  const rhythm = summarizeRhythm(inv.rhythm, []);
  const until = inv.endDate ? ` until ${formatDate(inv.endDate)}` : "";
  return `${rhythm} · from ${formatDate(inv.startDate)}${until}`;
}

function InvitationCard({
  inv,
  tagMap,
  onJoin,
  onEdit,
  onChanged,
}: {
  inv: Invitation;
  tagMap: TagMap;
  onJoin: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const timeFormat = useTimeFormat();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Array<{ userId: string; name: string }> | null>(null);
  const full = inv.capacity !== null && inv.attendeeCount >= inv.capacity;

  const times = inv.scheduledTimes
    .map((t, i) => formatTimeRange(t, inv.scheduledEndTimes[i], timeFormat))
    .join(", ");
  const host = inv.hostCommunityName ?? inv.hostName ?? "Someone";
  const audience =
    inv.audience === "community"
      ? inv.audienceCommunityName ?? AUDIENCE_LABEL.community
      : inv.audience === "nearby" && inv.radiusKm
        ? `Nearby (${inv.radiusKm} km)`
        : AUDIENCE_LABEL[inv.audience];

  function run(fn: () => Promise<{ error: string } | { ok: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) setError(res.error);
      else onChanged();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{inv.name}</p>
          <p className="text-xs text-zinc-500">
            {inv.hostCommunityName ? "Hosted by " : "From "}
            {host}
          </p>
        </div>
        {inv.iAmGoing && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ Going
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-zinc-700 dark:text-zinc-300">
        <p>
          🗓 {whenLabel(inv)}
          {times ? ` · ${times}` : ""}
        </p>
        <p>
          📍 {inv.locationName}
          {inv.distanceKm !== null ? ` · ${formatDistance(inv.distanceKm)} away` : ""}
        </p>
      </div>

      {inv.notes && (
        <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
          {inv.notes}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {audience}
        </span>
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {SKILL_LABEL[inv.skillLevel]}
        </span>
        <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {inv.attendeeCount} going
          {inv.capacity !== null ? ` · ${Math.max(inv.capacity - inv.attendeeCount, 0)} spots left` : ""}
        </span>
        {inv.tags.map((t) => (
          <TagChip key={t} name={t} tags={tagMap} size="xs" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {inv.iAmGoing && inv.myActivityId ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!window.confirm(`Leave "${inv.name}"? It'll be archived from your calendar.`))
                return;
              run(() => leaveInvitation(inv.id));
            }}
            className={smallBtn}
          >
            Leave
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending || full}
            onClick={onJoin}
            className={primaryBtn}
          >
            {full ? "Full" : "+ Add to my calendar"}
          </button>
        )}
        {inv.canManage && (
          <>
            <button type="button" onClick={onEdit} className={smallBtn}>
              Edit
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (attendees) {
                  setAttendees(null);
                  return;
                }
                startTransition(async () => {
                  setAttendees(await getInvitationAttendees(inv.id));
                });
              }}
              className={smallBtn}
            >
              {attendees ? "Hide attendees" : "Attendees"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!window.confirm(`Cancel "${inv.name}"? People who joined keep it on their calendars.`))
                  return;
                run(() => cancelInvitation(inv.id));
              }}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              Cancel invitation
            </button>
          </>
        )}
      </div>

      {attendees && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {attendees.length === 0
            ? "No one has joined yet."
            : attendees.map((a) => a.name).join(", ")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

// --- add to calendar (reminders) --------------------------------------------

function AddToCalendarModal({
  inv,
  onClose,
  onDone,
}: {
  inv: Invitation;
  onClose: () => void;
  onDone: () => void;
}) {
  useBodyScrollLock();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const bound = addInvitationToCalendarFormAction.bind(null, inv.id);
  const [state, formAction, isPending] = useActionState(bound, null);

  useEffect(() => {
    if (state && "ok" in state) onDone();
  }, [state, onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <form
        action={formAction}
        className="flex max-h-[90svh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-xl bg-white p-5 sm:rounded-xl dark:bg-zinc-950"
      >
        <h2 className="text-lg font-semibold tracking-tight">Add “{inv.name}” to your calendar</h2>
        <p className="text-xs text-zinc-500">
          📍 {inv.locationName} · {whenLabel(inv)}
        </p>
        <RemindersField reminders={reminders} setReminders={setReminders} />
        {state && "error" in state && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={smallBtn}>
            Cancel
          </button>
          <button type="submit" disabled={isPending} className={primaryBtn}>
            {isPending ? "Adding…" : "Add to my calendar"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- create / edit form -----------------------------------------------------

function InvitationFormModal({
  existing,
  communities,
  tagMap,
  onClose,
  onSaved,
}: {
  existing: Invitation | null;
  communities: InvitationCommunity[];
  tagMap: TagMap;
  onClose: () => void;
  onSaved: () => void;
}) {
  useBodyScrollLock();
  const todayStr = new Date().toISOString().slice(0, 10);
  const boundAction = existing
    ? updateInvitationFormAction.bind(null, existing.id)
    : createInvitationFormAction;
  const [state, formAction, isPending] = useActionState(boundAction, null);

  useEffect(() => {
    if (state && "ok" in state) onSaved();
  }, [state, onSaved]);

  const hostable = communities.filter((c) => c.canHost);
  const [hostCommunityId, setHostCommunityId] = useState<string>(
    existing?.hostCommunityId ?? ""
  );
  const [audience, setAudience] = useState<InvitationAudience>(
    existing?.audience ?? "friends"
  );
  const [audienceCommunityId, setAudienceCommunityId] = useState<string>(
    existing?.audienceCommunityId ?? communities[0]?.id ?? ""
  );
  const [skill, setSkill] = useState<SkillLevel>(existing?.skillLevel ?? "all");
  const [coords, setCoords] = useState<Coords | null>(
    existing?.latitude != null && existing?.longitude != null
      ? { lat: existing.latitude, lng: existing.longitude }
      : null
  );
  const [radiusKm, setRadiusKm] = useState<string>(
    existing?.radiusKm != null ? String(existing.radiusKm) : "10"
  );
  const [locError, setLocError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // A community-hosted invitation can't target "friends"; a person can only
  // target "community" if they belong to one.
  const audienceOptions: Array<readonly [InvitationAudience, string]> = (
    [
      ["friends", AUDIENCE_LABEL.friends],
      ["community", AUDIENCE_LABEL.community],
      ["nearby", AUDIENCE_LABEL.nearby],
      ["public", AUDIENCE_LABEL.public],
    ] as Array<readonly [InvitationAudience, string]>
  ).filter(([v]) => {
    if (v === "friends") return !hostCommunityId;
    if (v === "community") return Boolean(hostCommunityId) || communities.length > 0;
    return true;
  });
  const effectiveAudience = audienceOptions.some(([v]) => v === audience)
    ? audience
    : audienceOptions[0][0];

  async function locate() {
    setLocError(null);
    setLocating(true);
    try {
      setCoords(await getBrowserCoords());
    } catch (e) {
      setLocError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }

  const initialValues: ActivityFormInitial = {
    name: existing?.name ?? "",
    notes: existing?.notes ?? null,
    rhythm: existing?.rhythm ?? { type: "single" },
    priority: 2,
    scheduled_times: existing?.scheduledTimes ?? ["18:00"],
    scheduled_end_times: existing?.scheduledEndTimes ?? [""],
    default_skill_tags: existing?.tags ?? [],
    start_date: existing?.startDate ?? todayStr,
    end_date: existing?.endDate ?? null,
    reminders: [] as unknown as ActivityFormInitial["reminders"],
    track_on_grid: false,
    rollover_missed_days: false,
    rollover_change_rhythm: false,
    auto_archive: false,
    pinned: false,
    auto_resolve: false,
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <form
        action={formAction}
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto p-6"
      >
        <button
          type="button"
          onClick={onClose}
          className="self-start text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-semibold tracking-tight">
          {existing ? "Edit invitation" : "New invitation"}
        </h2>

        <input type="hidden" name="hostCommunityId" value={hostCommunityId} />
        <input type="hidden" name="audience" value={effectiveAudience} />
        <input
          type="hidden"
          name="audienceCommunityId"
          value={effectiveAudience === "community" ? hostCommunityId || audienceCommunityId : ""}
        />
        <input type="hidden" name="skillLevel" value={skill} />
        <input type="hidden" name="latitude" value={coords ? String(coords.lat) : ""} />
        <input type="hidden" name="longitude" value={coords ? String(coords.lng) : ""} />

        {!existing && hostable.length > 0 && (
          <select
            value={hostCommunityId}
            onChange={(e) => setHostCommunityId(e.target.value)}
            className={inputCls}
            aria-label="Host"
          >
            <option value="">Host: me</option>
            {hostable.map((c) => (
              <option key={c.id} value={c.id}>
                Host: {c.name}
              </option>
            ))}
          </select>
        )}

        <ActivityFormFields
          initialValues={initialValues}
          tagMap={tagMap}
          showPriority={false}
          showStreaks={false}
          showPinned={false}
          showReminders={false}
          showRollover={false}
          showCompletionMode={false}
          showGoal={false}
        />

        <label className="block">
          <span className="text-sm font-medium">Location</span>
          <input
            type="text"
            name="locationName"
            required
            maxLength={200}
            defaultValue={existing?.locationName ?? ""}
            placeholder="e.g. Riverside Park, north entrance"
            className={inputCls}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => void locate()}
            disabled={locating}
            className={smallBtn}
          >
            {locating ? "Locating…" : coords ? "📍 Update to my current location" : "📍 Use my current location"}
          </button>
          {coords && (
            <>
              <span className="text-zinc-500">
                Pinned at {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
              </span>
              <button
                type="button"
                onClick={() => setCoords(null)}
                className="text-zinc-500 underline-offset-2 hover:underline"
              >
                Clear
              </button>
            </>
          )}
        </div>
        {locError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {locError}
          </p>
        )}

        <Segmented
          options={audienceOptions}
          value={effectiveAudience}
          onChange={(v) => setAudience(v as InvitationAudience)}
        />
        {effectiveAudience === "community" && !hostCommunityId && (
          <select
            value={audienceCommunityId}
            onChange={(e) => setAudienceCommunityId(e.target.value)}
            className={inputCls}
            aria-label="Community to invite"
          >
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {effectiveAudience === "nearby" && (
          <label className="flex items-center gap-2 text-sm">
            Within
            <input
              type="number"
              name="radiusKm"
              min={1}
              max={1000}
              value={radiusKm}
              onChange={(e) => setRadiusKm(e.target.value)}
              className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            km of the pinned location
          </label>
        )}

        <Segmented
          options={SKILL_LEVELS.map((s) => [s, SKILL_LABEL[s]] as const)}
          value={skill}
          onChange={(v) => setSkill(v as SkillLevel)}
        />

        <label className="flex items-center gap-2 text-sm">
          Spots
          <input
            type="number"
            name="capacity"
            min={1}
            max={10000}
            defaultValue={existing?.capacity ?? ""}
            placeholder="No limit"
            className="w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        {state && "error" in state && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Saving…" : existing ? "Save invitation" : "Post invitation"}
          </button>
        </div>
      </form>
    </div>
  );
}
