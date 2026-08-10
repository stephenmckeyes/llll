-- 0036 — timeline conflict acknowledgements (cross-device persist).
--
-- Was localStorage-only; ack'ing on one device didn't sync elsewhere.
-- Now a per-user row keyed by pair_key:
--   pair_key = `${date}|${eventKey1}|${eventKey2}`
-- where eventKey1 < eventKey2 (deterministic ordering so A×B and
-- B×A collapse to the same row). The Timeline detects conflicts
-- client-side but filters out any pair whose key is in this table.
-- The /notifications page ALSO surfaces unacknowledged conflicts
-- (today only) so users see them even without opening Timeline.

CREATE TABLE IF NOT EXISTS public.conflict_acknowledgements (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pair_key text NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pair_key)
);

CREATE INDEX IF NOT EXISTS conflict_acknowledgements_user_idx
  ON public.conflict_acknowledgements (user_id);

ALTER TABLE public.conflict_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conflict_acks_select_own ON public.conflict_acknowledgements;
CREATE POLICY conflict_acks_select_own ON public.conflict_acknowledgements
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS conflict_acks_write_own ON public.conflict_acknowledgements;
CREATE POLICY conflict_acks_write_own ON public.conflict_acknowledgements
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
