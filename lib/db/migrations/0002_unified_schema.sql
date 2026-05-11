-- ===========================================================================
-- Schema unification: merge recurring_activities + tasks into one `activities`
-- table. Tasks become a `rhythm: {type: "single"}` row. Every activity
-- (recurring or one-off) produces instances; completions link to instances
-- via a single completion_instances table.
--
-- This is a destructive migration: it drops every user-data table and
-- recreates them with the new shape. Acceptable while we have no real
-- production data; profiles (and auth.users) are preserved.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop everything we're replacing. CASCADE handles FK dependencies.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.completion_tasks CASCADE;
DROP TABLE IF EXISTS public.completion_instances CASCADE;
DROP TABLE IF EXISTS public.completions CASCADE;
DROP TABLE IF EXISTS public.recurring_activity_instances CASCADE;
DROP TABLE IF EXISTS public.recurring_activities CASCADE;
DROP TABLE IF EXISTS public.tasks CASCADE;

-- task_status enum is no longer used — tasks are now activities with a
-- "single" rhythm, and use instance_status like everything else.
DROP TYPE IF EXISTS public.task_status;

-- ---------------------------------------------------------------------------
-- 2. activities — the unified producer table.
--
-- One row per intent (one-off or recurring). The `rhythm` column tells the
-- generator what dates to schedule; `start_date` / `end_date` bound the
-- range (end_date NULL = open-ended).
-- ---------------------------------------------------------------------------

CREATE TABLE public.activities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name                text NOT NULL,
  notes               text,
  rhythm              jsonb NOT NULL,
  start_date          date NOT NULL DEFAULT CURRENT_DATE,
  end_date            date,
  priority            smallint NOT NULL DEFAULT 2,   -- 1=high, 2=med, 3=low
  default_skill_tags  text[] NOT NULL DEFAULT '{}'::text[],
  default_metrics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility          public.visibility NOT NULL DEFAULT 'private',
  abandoned_reason    text,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX activities_user_idx ON public.activities(user_id);

-- ---------------------------------------------------------------------------
-- 3. activity_instances — scheduled occurrences of an activity.
--
-- Singles produce exactly one instance (on start_date). Recurring rhythms
-- produce many. Frequency rhythms produce one instance per period (week/
-- month/day) and use the activity's rhythm.count as a target — they stay
-- `pending` until that many completions are linked.
-- ---------------------------------------------------------------------------

CREATE TABLE public.activity_instances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  scheduled_for date NOT NULL,
  status        public.instance_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ai_activity_date_idx ON public.activity_instances(activity_id, scheduled_for);
CREATE INDEX ai_status_idx ON public.activity_instances(status);

-- ---------------------------------------------------------------------------
-- 4. completions — atomic "I did a thing." Append-only, soft-delete only.
-- ---------------------------------------------------------------------------

CREATE TABLE public.completions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL,
  skill_tags    text[] NOT NULL DEFAULT '{}'::text[],
  metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  effort_rating smallint,
  note          text,
  visibility    public.visibility NOT NULL DEFAULT 'private',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  deleted_at    timestamptz
);

CREATE INDEX completions_user_occurred_idx ON public.completions(user_id, occurred_at);

-- ---------------------------------------------------------------------------
-- 5. completion_instances — M:N link: completions ↔ activity_instances.
--
-- This is now the only producer ↔ completion link table (no more
-- completion_tasks). One completion can satisfy multiple instances; one
-- instance can be satisfied by multiple completions (frequency rhythms).
-- ---------------------------------------------------------------------------

CREATE TABLE public.completion_instances (
  completion_id uuid NOT NULL REFERENCES public.completions(id)         ON DELETE CASCADE,
  instance_id   uuid NOT NULL REFERENCES public.activity_instances(id)  ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX completion_instances_pk ON public.completion_instances(completion_id, instance_id);
CREATE INDEX completion_instances_instance_idx ON public.completion_instances(instance_id);

-- ---------------------------------------------------------------------------
-- 6. RLS — enable + per-table policies.
-- ---------------------------------------------------------------------------

ALTER TABLE public.activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_instances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_self ON public.activities
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY activity_instances_self ON public.activity_instances
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = activity_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = activity_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY completions_self ON public.completions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY completion_instances_self ON public.completion_instances
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  );
