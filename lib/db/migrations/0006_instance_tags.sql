-- ===========================================================================
-- Per-instance tag snapshot.
-- ---------------------------------------------------------------------------
-- Before this migration, activity tags lived ONLY on
-- `activities.default_skill_tags text[]` (the activity's current set).
-- Calendar/Day/Week/Month views displayed those tags for every
-- occurrence — meaning if the user edited the activity's tags, every
-- past visualization shifted to the new set. That violated the
-- "immutable history" principle the codebase otherwise upholds.
--
-- This migration snapshots tags PER INSTANCE:
--
--   1. Add `activity_instances.tags text[]` defaulted to '{}'.
--   2. Backfill every existing instance with its parent activity's
--      current tags (best approximation we have for historical data).
--   3. Going forward, `createActivity` + `updateActivityRhythm`'s
--      instance generation will copy `activity.default_skill_tags`
--      into each new instance's `tags` at generation time. Edit
--      Activity (metadata-only) NEVER touches existing instances'
--      tags — so past + already-generated future instances are
--      frozen. Edit Rhythm regenerates pending future instances,
--      which then pick up the new activity tags fresh.
--
-- Activity-level surfaces (Archive page, Grid view row label,
-- modal details) keep reading from `activities.default_skill_tags`
-- since those represent the activity's CURRENT identity, not a
-- specific occurrence's tags. The split between
-- activity-level vs. instance-level reads is the architectural
-- payoff.
-- ===========================================================================

ALTER TABLE public.activity_instances
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------------
-- Backfill: copy each activity's current default_skill_tags into all of
-- its existing instances. Only touches rows where instance.tags is
-- still the empty default — re-running the migration is idempotent.
-- ---------------------------------------------------------------------------

UPDATE public.activity_instances AS ai
SET    tags = a.default_skill_tags
FROM   public.activities AS a
WHERE  ai.activity_id = a.id
  AND  ai.tags = '{}'::text[];
