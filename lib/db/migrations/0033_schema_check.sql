-- 0033 — schema-check RPC.
--
-- Ships one SECURITY DEFINER function that returns every (table,
-- column) pair in the public schema. The app compares this against a
-- hard-coded expected list (see lib/db/schema-check.ts) and, if
-- anything is missing, shows a red banner on every page: "Migration
-- 00XX not applied — paste …".
--
-- Rationale: today missing a migration silently returns empty data
-- (SELECTs that reference a not-yet-added column error out and every
-- page renders as "you have nothing"). That's indistinguishable from
-- "my account was wiped" — real panic. This RPC arms the banner so
-- future missed migrations get called out by name instead.

CREATE OR REPLACE FUNCTION public.list_schema_columns()
RETURNS TABLE (table_name text, column_name text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT c.relname::text, a.attname::text
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'          -- ordinary tables only
    AND a.attnum > 0             -- skip system cols
    AND NOT a.attisdropped;
$$;

REVOKE ALL ON FUNCTION public.list_schema_columns() FROM public;
GRANT EXECUTE ON FUNCTION public.list_schema_columns() TO authenticated;
