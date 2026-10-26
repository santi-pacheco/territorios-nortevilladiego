-- Split the program-editing grant in two: the midweek meeting and the weekend meeting.
--
--   profiles.can_edit_programa              REMOVED (migrated into the two flags below)
--   profiles.can_edit_programa_midweek      grant to edit the midweek meeting (Tuesday row)
--   profiles.can_edit_programa_weekend      grant to edit the weekend meeting (Saturday row)
--   private.can_edit_programa_midweek()     editor/admin or can_edit_programa_midweek
--   private.can_edit_programa_weekend()     editor/admin or can_edit_programa_weekend
--   private.can_edit_programa()             editor/admin or EITHER grant (person pickers)
--   program_weeks write policies            the row's kind decides which grant is needed
--   public.set_account_permissions()        p_midweek / p_weekend / p_privilegios
--   public.my_permissions()                 + can_edit_programa_midweek / _weekend
--   public.list_accounts()                  + can_edit_programa_midweek / _weekend
--
-- Migration is lossless for real users: everyone who could edit the program keeps editing all of
-- it, because the old flag becomes both new flags. Editors and admins are effective editors of
-- both parts regardless of the stored flags, exactly as before.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column can_edit_programa_midweek boolean not null default false,
  add column can_edit_programa_weekend boolean not null default false;

update public.profiles
   set can_edit_programa_midweek = can_edit_programa,
       can_edit_programa_weekend = can_edit_programa
 where can_edit_programa;

comment on column public.profiles.can_edit_programa_midweek is
  'Grant to edit the midweek meeting (program_weeks kind = midweek) without the editor role. Written only by public.set_account_permissions() (no column grant).';
comment on column public.profiles.can_edit_programa_weekend is
  'Grant to edit the weekend meeting (program_weeks kind = weekend) without the editor role. Written only by public.set_account_permissions() (no column grant).';

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------
create or replace function private.can_edit_programa_midweek()
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
       and (p.role in ('editor', 'admin') or p.can_edit_programa_midweek)
  );
$$;
comment on function private.can_edit_programa_midweek() is
  'Editor/admin, or profiles.can_edit_programa_midweek.';

create or replace function private.can_edit_programa_weekend()
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
       and (p.role in ('editor', 'admin') or p.can_edit_programa_weekend)
  );
$$;
comment on function private.can_edit_programa_weekend() is
  'Editor/admin, or profiles.can_edit_programa_weekend.';

-- Kept for the person pickers and people_directory(): anyone who edits either meeting may pick
-- (and create) the people it names.
create or replace function private.can_edit_programa()
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
       and (p.role in ('editor', 'admin') or p.can_edit_programa_midweek
            or p.can_edit_programa_weekend)
  );
$$;
comment on function private.can_edit_programa() is
  'Editor/admin, or either program-editing grant. Used by the person pickers.';

-- ---------------------------------------------------------------------------
-- program_weeks: the row's kind decides which grant is required.
-- On UPDATE, USING sees the old row and WITH CHECK the new one, so nobody can move a row from a
-- meeting they may edit into the other one without that other grant too.
-- ---------------------------------------------------------------------------
drop policy program_weeks_insert_programa on public.program_weeks;
drop policy program_weeks_update_programa on public.program_weeks;
drop policy program_weeks_delete_programa on public.program_weeks;

create policy program_weeks_insert_programa on public.program_weeks
  for insert to authenticated
  with check (
    (kind = 'midweek' and (select private.can_edit_programa_midweek()))
    or (kind = 'weekend' and (select private.can_edit_programa_weekend()))
  );
create policy program_weeks_update_programa on public.program_weeks
  for update to authenticated
  using (
    (kind = 'midweek' and (select private.can_edit_programa_midweek()))
    or (kind = 'weekend' and (select private.can_edit_programa_weekend()))
  )
  with check (
    (kind = 'midweek' and (select private.can_edit_programa_midweek()))
    or (kind = 'weekend' and (select private.can_edit_programa_weekend()))
  );
create policy program_weeks_delete_programa on public.program_weeks
  for delete to authenticated
  using (
    (kind = 'midweek' and (select private.can_edit_programa_midweek()))
    or (kind = 'weekend' and (select private.can_edit_programa_weekend()))
  );

-- ---------------------------------------------------------------------------
-- Permission RPCs. my_permissions / list_accounts change their row shape and
-- set_account_permissions its signature, so they are dropped and recreated (create or replace
-- cannot change a return type).
-- ---------------------------------------------------------------------------
drop function public.my_permissions();

create function public.my_permissions()
returns table (
  role                        text,
  can_edit_programa_midweek   boolean,
  can_edit_programa_weekend   boolean,
  can_edit_privilegios        boolean,
  sees_privilegios            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(pr.role, 'viewer')::text,
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_programa_midweek, false),
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_programa_weekend, false),
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_privilegios, false),
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_privilegios or cardinality(p.duties) > 0, false)
  from (select (select auth.uid()) as uid) u
  left join public.profiles pr on pr.id = u.uid
  left join public.people p on p.id = pr.person_id;
$$;
comment on function public.my_permissions() is
  'The caller''s role and effective midweek/weekend program and privilegios permissions (editors/admins: true). One row.';

drop function public.list_accounts();

create function public.list_accounts()
returns table (
  user_id                     uuid,
  email                       text,
  display_name                text,
  avatar_url                  text,
  provider                    text,
  role                        text,
  person_id                   uuid,
  person_name                 text,
  created_at                  timestamptz,
  can_edit_programa_midweek   boolean,
  can_edit_programa_weekend   boolean,
  can_edit_privilegios        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_editor() then
    raise exception 'list_accounts: editor role required' using errcode = '42501';
  end if;

  return query
    select
      u.id,
      u.email::text,
      coalesce(pr.display_name, u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')::text,
      coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')::text,
      (u.raw_app_meta_data ->> 'provider')::text,
      coalesce(pr.role, 'viewer')::text,
      pr.person_id,
      p.name::text,
      u.created_at,
      coalesce(pr.can_edit_programa_midweek, false),
      coalesce(pr.can_edit_programa_weekend, false),
      coalesce(pr.can_edit_privilegios, false)
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.people p on p.id = pr.person_id
    order by u.created_at desc;
end;
$$;
comment on function public.list_accounts() is
  'Every auth user with role, linked person and the stored midweek/weekend program and privilegios grants. Editor/admin only.';

drop function public.set_account_permissions(uuid, boolean, boolean);

create function public.set_account_permissions(
  p_user uuid,
  p_midweek boolean,
  p_weekend boolean,
  p_privilegios boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'set_account_permissions: admin role required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'set_account_permissions: unknown user' using errcode = 'P0002';
  end if;

  insert into public.profiles as pr (
    id, role, can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios
  )
  values (
    p_user,
    'viewer',
    coalesce(p_midweek, false),
    coalesce(p_weekend, false),
    coalesce(p_privilegios, false)
  )
  on conflict (id) do update
    set can_edit_programa_midweek = coalesce(p_midweek, pr.can_edit_programa_midweek),
        can_edit_programa_weekend = coalesce(p_weekend, pr.can_edit_programa_weekend),
        can_edit_privilegios = coalesce(p_privilegios, pr.can_edit_privilegios)
  where pr.can_edit_programa_midweek is distinct from coalesce(p_midweek, pr.can_edit_programa_midweek)
     or pr.can_edit_programa_weekend is distinct from coalesce(p_weekend, pr.can_edit_programa_weekend)
     or pr.can_edit_privilegios is distinct from coalesce(p_privilegios, pr.can_edit_privilegios);
end;
$$;
comment on function public.set_account_permissions(uuid, boolean, boolean, boolean) is
  'Grant/revoke can_edit_programa_midweek, can_edit_programa_weekend and can_edit_privilegios (null = unchanged). Admin only.';

-- ---------------------------------------------------------------------------
-- Drop the old flag. Every function above is already free of it.
-- ---------------------------------------------------------------------------
alter table public.profiles drop column can_edit_programa;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function private.can_edit_programa_midweek() from public, anon, authenticated;
revoke all on function private.can_edit_programa_weekend() from public, anon, authenticated;
grant execute on function private.can_edit_programa_midweek() to authenticated;
grant execute on function private.can_edit_programa_weekend() to authenticated;

revoke all on function public.set_account_permissions(uuid, boolean, boolean, boolean) from public, anon;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.list_accounts() from public, anon;

grant execute on function public.set_account_permissions(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.list_accounts() to authenticated;
