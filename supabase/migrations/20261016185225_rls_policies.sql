-- TerritoriosMap 2.0: grants + RLS.
--
-- Access model
--   anon            SELECT public tables. Nothing else.
--   authenticated   SELECT public tables. Role comes from public.profiles.role:
--     viewer        (or no profile row) read-only, same as anon.
--     editor/admin  read people/person_availability/person_pairs, write every app table.
--   device_tokens   each user sees and manages only their own rows.
--   profiles        each user reads their own row and may edit only display_name.
--                   role is changed only by the owner (SQL editor / service role).
--   secret key      server-only role that bypasses RLS (import scripts, push Edge Function). Never ship it to clients.
--
-- Grants are explicit. Supabase's default privileges grant ALL (incl. TRUNCATE,
-- which RLS does not cover) to anon/authenticated, so revoke first.

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY INVOKER: they read the caller's own profile row,
-- which the profiles_select_own policy allows; no RLS bypass).
-- ---------------------------------------------------------------------------
create or replace function public.is_editor()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role in ('editor', 'admin')
  );
$$;
comment on function public.is_editor() is 'True when the caller''s profile role is editor or admin.';

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = 'admin'
  );
$$;
comment on function public.is_admin() is 'True when the caller''s profile role is admin.';

revoke all on function public.is_editor() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_editor() to authenticated;
grant execute on function public.is_admin() to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

-- Future tables/functions in public get no implicit access; each migration grants explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- Public schedule data: everyone reads, editors write (RLS decides who is an editor).
grant select on
  public.territories, public.service_weeks, public.service_meetings,
  public.cart_places, public.cart_slots, public.cart_schedules,
  public.cart_assignments, public.cart_blackouts, public.program_weeks
to anon, authenticated;

grant insert, update, delete on
  public.territories, public.service_weeks, public.service_meetings,
  public.cart_places, public.cart_slots, public.cart_schedules,
  public.cart_assignments, public.cart_blackouts, public.program_weeks
to authenticated;

-- PII: no anon access at all; authenticated gated by is_editor() in RLS.
grant select, insert, update, delete on
  public.people, public.person_availability, public.person_pairs
to authenticated;

-- profiles: read own row, edit only display_name. No insert/delete for clients.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- device_tokens: own rows only (RLS).
grant select, insert, update, delete on public.device_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: enable on every table
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'territories', 'service_weeks', 'service_meetings',
    'cart_places', 'cart_slots', 'people', 'person_availability', 'person_pairs',
    'cart_schedules', 'cart_assignments', 'cart_blackouts', 'program_weeks', 'device_tokens'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public tables: read for anon+authenticated, write for editors.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'territories', 'service_weeks', 'service_meetings',
    'cart_places', 'cart_slots', 'cart_schedules',
    'cart_assignments', 'cart_blackouts', 'program_weeks'
  ] loop
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_select_public', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.is_editor()))',
      t || '_insert_editor', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))',
      t || '_update_editor', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.is_editor()))',
      t || '_delete_editor', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Editor-only tables (PII): read and write for editors only.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['people', 'person_availability', 'person_pairs'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_editor()))',
      t || '_select_editor', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select public.is_editor()))',
      t || '_insert_editor', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.is_editor())) with check ((select public.is_editor()))',
      t || '_update_editor', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select public.is_editor()))',
      t || '_delete_editor', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles. These policies must never call is_editor()/is_admin() (they read
-- profiles themselves → infinite recursion).
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- Column grant limits this to display_name; role cannot be self-escalated.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- device_tokens: own rows only.
-- ---------------------------------------------------------------------------
create policy device_tokens_select_own on public.device_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy device_tokens_insert_own on public.device_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy device_tokens_update_own on public.device_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy device_tokens_delete_own on public.device_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime: clients invalidate queries on change events (RLS still applies).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.territories, public.service_weeks, public.service_meetings,
  public.cart_places, public.cart_slots, public.people, public.person_availability,
  public.person_pairs, public.cart_schedules, public.cart_assignments,
  public.cart_blackouts, public.program_weeks;
