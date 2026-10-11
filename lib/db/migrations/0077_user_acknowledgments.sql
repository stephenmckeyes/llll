-- ---------------------------------------------------------------------------
-- 0077 — User acknowledgments (first-run intros + terms/disclaimers).
--
-- One small per-user table backs two things:
--   * First-run page intros — a popup the first time a user opens a surface.
--   * Terms/disclaimers — a blocking accept before first use of Coaches /
--     Community features (so people acknowledge conduct rules + liability).
--
-- Each row is (user_id, ack_key, version). The CLIENT knows the required
-- version per key (lib/domain/agreements.ts); if the stored version is lower
-- (or missing), the intro/terms is shown again — so bumping a terms version
-- re-prompts everyone. Intros just use version 1 (seen = acknowledged).
--
-- Direct RLS access (owner only); no RPC needed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_acknowledgments (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ack_key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ack_key)
);

ALTER TABLE public.user_acknowledgments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_ack_select ON public.user_acknowledgments;
CREATE POLICY user_ack_select ON public.user_acknowledgments
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_ack_insert ON public.user_acknowledgments;
CREATE POLICY user_ack_insert ON public.user_acknowledgments
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_ack_update ON public.user_acknowledgments;
CREATE POLICY user_ack_update ON public.user_acknowledgments
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
