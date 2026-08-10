-- 0035 — Pinned activities.
--
-- New per-activity flag: "the user may want to re-initiate this
-- later." Independent of auto_archive (which continues to control
-- whether a completed occurrence sends the activity to Past). A pinned
-- activity shows up in Total View's Pinned filter regardless of
-- Active / Past / Archived status, so completed singles the user
-- wants to redo stay one tap away instead of buried in the archive.
--
-- Migration is additive; existing activities keep behavior. Users
-- pin ones they care about via the new "Pinned" toggle on Add
-- Activity (which replaces the old "Keep on Active" toggle).

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS activities_pinned_idx
  ON public.activities (user_id, pinned)
  WHERE pinned = true;
