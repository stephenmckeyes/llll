-- ============================================================================
-- 0038 · delete_tag_cascade RPC
--
-- Tag names live in two text[] columns (`activities.default_skill_tags`
-- and `activity_instances.tags`). Deleting a tag row without stripping
-- the name from those arrays would leave orphan references the UI still
-- rendered.  This RPC bundles the three writes into a single
-- transactional call, gated by an explicit owner check so users can
-- only delete their own tags.
-- ============================================================================

create or replace function public.delete_tag_cascade(
  p_tag_id uuid,
  p_tag_name text
)
returns table (
  removed_from_activities int,
  removed_from_instances  int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_from_activities int := 0;
  v_from_instances  int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select user_id into v_owner from tags where id = p_tag_id;
  if v_owner is null then
    raise exception 'tag not found';
  end if;
  if v_owner <> v_uid then
    raise exception 'not authorized';
  end if;

  -- Strip the name from every activities.default_skill_tags array.
  update activities
     set default_skill_tags = array_remove(default_skill_tags, p_tag_name)
   where user_id = v_uid
     and p_tag_name = any(default_skill_tags);
  get diagnostics v_from_activities = row_count;

  -- Strip the name from every activity_instances.tags array (scoped
  -- to instances the user owns via their activities).
  update activity_instances ai
     set tags = array_remove(ai.tags, p_tag_name)
    from activities a
   where ai.activity_id = a.id
     and a.user_id = v_uid
     and p_tag_name = any(ai.tags);
  get diagnostics v_from_instances = row_count;

  -- Finally drop the tag row itself.
  delete from tags where id = p_tag_id and user_id = v_uid;

  removed_from_activities := v_from_activities;
  removed_from_instances := v_from_instances;
  return next;
end;
$$;

grant execute on function public.delete_tag_cascade(uuid, text) to authenticated;
