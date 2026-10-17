-- People directory, program editor permissions and the Privilegios roster
-- (contract: docs/PRIVILEGIOS.md).
--
--   people.in_carrito / people.duties                  carrito roster flag + which privilegios a person takes
--   profiles.can_edit_programa / can_edit_privilegios  per-account grants (editors/admins always have both)
--   private.can_edit_programa / can_edit_privilegios / sees_privilegios   RLS helpers
--   program_weeks write policies                       editors OR can_edit_programa
--   public.duty_roster / public.duty_days              Privilegios roster (Tuesday + Saturday meetings)
--   public.name_sources / create_person_from_name / add_person_alias      editor RPCs (people directory)
--   public.set_account_permissions / my_permissions / duty_people         permission RPCs
--   private.assignments_for_person                     gains kind 'privilegio'
--   public.list_accounts                               gains the two permission columns

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.people
  add column in_carrito boolean not null default true,
  add column duties text[] not null default '{}'
    check (duties <@ array['computadora', 'sonido', 'microfonista', 'acomodador']::text[]);
comment on column public.people.in_carrito is
  'Takes part in the carrito (scheduler + carrito pickers). People created from other areas start as false.';
comment on column public.people.duties is
  'Privilegios this person can take: computadora, sonido, microfonista, acomodador.';

alter table public.profiles
  add column can_edit_programa boolean not null default false,
  add column can_edit_privilegios boolean not null default false;
comment on column public.profiles.can_edit_programa is
  'Grant to edit program_weeks without the editor role. Written only by public.set_account_permissions() (no column grant).';
comment on column public.profiles.can_edit_privilegios is
  'Grant to edit duty_roster/duty_days without the editor role. Written only by public.set_account_permissions() (no column grant).';

-- ---------------------------------------------------------------------------
-- Privilegios roster
-- ---------------------------------------------------------------------------
create table public.duty_roster (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  role        text not null check (role in ('computadora', 'sonido', 'microfonista', 'acomodador')),
  slot        smallint not null check (slot between 1 and 4),
  person_id   uuid references public.people (id) on delete set null,
  person_name text check (person_name is null or char_length(person_name) between 1 and 120),
  note        text check (note is null or char_length(note) <= 500),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  constraint duty_roster_cell_unique unique (date, role, slot),
  constraint duty_roster_who check (person_id is not null or person_name is not null)
);
create index duty_roster_person_id_idx on public.duty_roster (person_id);
comment on table public.duty_roster is
  'One cell of the Privilegios roster (Computadora, Sonido, Microfonistas, Acomodadores) on a meeting day.';
comment on column public.duty_roster.person_name is
  'Snapshot of people.name when person_id is set (trigger, kept in sync on rename); free text otherwise. Always display this.';

create table public.duty_days (
  date       date primary key,
  kind       text not null default 'normal' check (kind in ('normal', 'asamblea', 'sin_reunion')),
  note       text check (note is null or char_length(note) <= 200),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.duty_days is 'Marks a meeting day of the Privilegios roster (assembly week, no meeting).';

create trigger duty_roster_bump_version
  before insert or update on public.duty_roster
  for each row execute function private.bump_version();
create trigger duty_days_bump_version
  before insert or update on public.duty_days
  for each row execute function private.bump_version();

-- person_name follows people.name for matched cells. DEFINER: a can_edit_privilegios user
-- cannot read people under RLS, yet may pick a person id (from public.duty_people()).
create or replace function private.fill_duty_person_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.person_id is not null then
    select p.name into v_name from public.people p where p.id = new.person_id;
    if v_name is null then
      raise exception 'duty_roster.person_id references an unknown person' using errcode = '23503';
    end if;
    new.person_name := v_name;
  else
    new.person_name := nullif(regexp_replace(trim(coalesce(new.person_name, '')), '\s+', ' ', 'g'), '');
  end if;
  return new;
end;
$$;
comment on function private.fill_duty_person_name() is
  'BEFORE INSERT/UPDATE on duty_roster: person_name = people.name when person_id is set, else trimmed free text.';

create trigger duty_roster_fill_name
  before insert or update on public.duty_roster
  for each row execute function private.fill_duty_person_name();

create or replace function private.sync_duty_roster_from_people()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.duty_roster
     set person_id = person_id  -- re-fires fill_duty_person_name
   where person_id = new.id;
  return new;
end;
$$;

create trigger people_sync_duty_roster
  after update of name on public.people
  for each row
  when (new.name is distinct from old.name)
  execute function private.sync_duty_roster_from_people();

-- ---------------------------------------------------------------------------
-- Permission helpers (called from RLS policies, so authenticated gets EXECUTE on these only)
-- ---------------------------------------------------------------------------
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
       and (p.role in ('editor', 'admin') or p.can_edit_programa)
  );
$$;
comment on function private.can_edit_programa() is 'Editor/admin, or profiles.can_edit_programa.';

create or replace function private.can_edit_privilegios()
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
       and (p.role in ('editor', 'admin') or p.can_edit_privilegios)
  );
$$;
comment on function private.can_edit_privilegios() is 'Editor/admin, or profiles.can_edit_privilegios.';

-- DEFINER: reads the linked person's duties, and people is editor-only under RLS.
create or replace function private.sees_privilegios()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles pr
      left join public.people p on p.id = pr.person_id
     where pr.id = (select auth.uid())
       and (pr.role in ('editor', 'admin') or pr.can_edit_privilegios or cardinality(p.duties) > 0)
  );
$$;
comment on function private.sees_privilegios() is
  'Editor/admin, can_edit_privilegios, or the caller''s linked person has any duty.';

-- ---------------------------------------------------------------------------
-- program_weeks: editors OR can_edit_programa write
-- ---------------------------------------------------------------------------
drop policy program_weeks_insert_editor on public.program_weeks;
drop policy program_weeks_update_editor on public.program_weeks;
drop policy program_weeks_delete_editor on public.program_weeks;

create policy program_weeks_insert_programa on public.program_weeks
  for insert to authenticated
  with check ((select private.can_edit_programa()));
create policy program_weeks_update_programa on public.program_weeks
  for update to authenticated
  using ((select private.can_edit_programa()))
  with check ((select private.can_edit_programa()));
create policy program_weeks_delete_programa on public.program_weeks
  for delete to authenticated
  using ((select private.can_edit_programa()));

-- ---------------------------------------------------------------------------
-- duty_roster / duty_days: read for sees_privilegios, write for can_edit_privilegios. No anon.
-- ---------------------------------------------------------------------------
alter table public.duty_roster enable row level security;
alter table public.duty_days enable row level security;

grant select, insert, update, delete on public.duty_roster, public.duty_days to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['duty_roster', 'duty_days'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.sees_privilegios()))',
      t || '_select_privilegios', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select private.can_edit_privilegios()))',
      t || '_insert_privilegios', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select private.can_edit_privilegios())) with check ((select private.can_edit_privilegios()))',
      t || '_update_privilegios', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select private.can_edit_privilegios()))',
      t || '_delete_privilegios', t);
  end loop;
end;
$$;

alter publication supabase_realtime add table public.duty_roster, public.duty_days;

-- ---------------------------------------------------------------------------
-- People directory RPCs (editor). DEFINER for private.norm_name; explicit role check.
-- ---------------------------------------------------------------------------
-- Every distinct name used by the program, salidas and unmatched roster cells, with the
-- person it already matches by name or alias (null = unlinked).
create or replace function public.name_sources()
returns table (
  name        text,
  norm        text,
  sources     text[],
  uses        integer,
  first_date  date,
  last_date   date,
  person_id   uuid,
  person_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_editor() then
    raise exception 'name_sources: editor role required' using errcode = '42501';
  end if;

  return query
    with raw as (
      select pp.person ->> 'name' as raw, 'programa'::text as source, w.date
        from public.program_weeks w
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(w.data -> 'parts') = 'array' then w.data -> 'parts' else '[]'::jsonb end
        ) as pt (part)
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(pt.part -> 'people') = 'array' then pt.part -> 'people' else '[]'::jsonb end
        ) as pp (person)
       where w.kind = 'midweek'
      union all
      select f.who, 'programa', w.date
        from public.program_weeks w
        cross join lateral (values
          (w.data ->> 'presidente'),
          (w.data ->> 'conductor'),
          (w.data ->> 'lector'),
          (w.data #>> '{discurso,orador}'),
          (w.data ->> 'oracionFinal')
        ) as f (who)
       where w.kind = 'weekend'
      union all
      select m.conductor, 'salida', sw.week_start + ((m.dow + 6) % 7)
        from public.service_meetings m
        join public.service_weeks sw on sw.id = m.week_id
      union all
      select d.person_name, 'privilegio', d.date
        from public.duty_roster d
       where d.person_id is null
    ),
    normed as (
      select regexp_replace(trim(r.raw), '\s+', ' ', 'g') as name, private.norm_name(r.raw) as norm,
             r.source, r.date
        from raw r
       where r.raw is not null
    ),
    grouped as (
      select n.norm,
             mode() within group (order by n.name) as name,
             array_agg(distinct n.source order by n.source) as sources,
             count(*)::integer as uses,
             min(n.date) as first_date,
             max(n.date) as last_date
        from normed n
       where n.norm <> ''
       group by n.norm
    ),
    matches as (
      select distinct on (x.n) x.n as norm, p.id, p.name
        from public.people p
        cross join lateral unnest(array_prepend(p.name, p.aliases)) as a (raw)
        cross join lateral (select private.norm_name(a.raw) as n) x
       where x.n <> ''
       order by x.n, p.name, p.id
    )
    select g.name, g.norm, g.sources, g.uses, g.first_date, g.last_date, m.id, m.name
      from grouped g
      left join matches m on m.norm = g.norm
     order by (m.id is null) desc, g.uses desc, g.name;
end;
$$;
comment on function public.name_sources() is
  'Distinct names in program_weeks, service_meetings.conductor and unmatched duty_roster cells, with the matching person (by name or alias) or null. Editor/admin only.';

create or replace function public.create_person_from_name(
  p_name text,
  p_gender text,
  p_in_carrito boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not public.is_editor() then
    raise exception 'create_person_from_name: editor role required' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'create_person_from_name: invalid name' using errcode = '22023';
  end if;
  if p_gender is null or p_gender not in ('M', 'F') then
    raise exception 'create_person_from_name: invalid gender %', p_gender using errcode = '22023';
  end if;
  if exists (
    select 1
      from public.people p
      cross join lateral unnest(array_prepend(p.name, p.aliases)) as a (raw)
     where private.norm_name(a.raw) = private.norm_name(v_name)
  ) then
    raise exception 'Ya existe una persona con ese nombre' using errcode = '23505';
  end if;

  insert into public.people (name, gender, in_carrito)
  values (v_name, p_gender, coalesce(p_in_carrito, false))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.create_person_from_name(text, text, boolean) is
  'Create a person from a name found by name_sources() (in_carrito defaults to false). 23505 if the name or an alias already matches someone. Editor/admin only.';

create or replace function public.add_person_alias(p_person uuid, p_alias text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alias text := regexp_replace(trim(coalesce(p_alias, '')), '\s+', ' ', 'g');
begin
  if not public.is_editor() then
    raise exception 'add_person_alias: editor role required' using errcode = '42501';
  end if;
  if v_alias = '' or char_length(v_alias) > 120 then
    raise exception 'add_person_alias: invalid alias' using errcode = '22023';
  end if;
  if not exists (select 1 from public.people p where p.id = p_person) then
    raise exception 'add_person_alias: unknown person' using errcode = 'P0002';
  end if;
  -- Already one of this person's names: nothing to do.
  if private.norm_name(v_alias) = any (private.person_match_names(p_person)) then
    return;
  end if;
  if exists (
    select 1
      from public.people p
      cross join lateral unnest(array_prepend(p.name, p.aliases)) as a (raw)
     where p.id <> p_person
       and private.norm_name(a.raw) = private.norm_name(v_alias)
  ) then
    raise exception 'Ese nombre ya corresponde a otra persona' using errcode = '23505';
  end if;

  update public.people
     set aliases = array_append(aliases, v_alias)
   where id = p_person;
end;
$$;
comment on function public.add_person_alias(uuid, text) is
  'Append an alias (no-op when it already matches the person; 23505 when it matches someone else). Editor/admin only.';

-- ---------------------------------------------------------------------------
-- Permission RPCs
-- ---------------------------------------------------------------------------
-- Null keeps the current value.
create or replace function public.set_account_permissions(
  p_user uuid,
  p_programa boolean,
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

  insert into public.profiles as pr (id, role, can_edit_programa, can_edit_privilegios)
  values (p_user, 'viewer', coalesce(p_programa, false), coalesce(p_privilegios, false))
  on conflict (id) do update
    set can_edit_programa = coalesce(p_programa, pr.can_edit_programa),
        can_edit_privilegios = coalesce(p_privilegios, pr.can_edit_privilegios)
  where pr.can_edit_programa is distinct from coalesce(p_programa, pr.can_edit_programa)
     or pr.can_edit_privilegios is distinct from coalesce(p_privilegios, pr.can_edit_privilegios);
end;
$$;
comment on function public.set_account_permissions(uuid, boolean, boolean) is
  'Grant/revoke can_edit_programa and can_edit_privilegios (null = unchanged). Admin only.';

-- Exactly one row. can_edit_* are EFFECTIVE (true for editors/admins).
create or replace function public.my_permissions()
returns table (
  role                 text,
  can_edit_programa    boolean,
  can_edit_privilegios boolean,
  sees_privilegios     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(pr.role, 'viewer')::text,
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_programa, false),
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_privilegios, false),
    coalesce(pr.role in ('editor', 'admin') or pr.can_edit_privilegios or cardinality(p.duties) > 0, false)
  from (select (select auth.uid()) as uid) u
  left join public.profiles pr on pr.id = u.uid
  left join public.people p on p.id = pr.person_id;
$$;
comment on function public.my_permissions() is
  'The caller''s role and effective programa/privilegios permissions (editors/admins: true). One row.';

-- Person pickers for Gestión ▸ Privilegios: can_edit_privilegios users cannot read people.
create or replace function public.duty_people()
returns table (id uuid, name text, duties text[], aliases text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_privilegios() then
    raise exception 'duty_people: privilegios permission required' using errcode = '42501';
  end if;

  return query
    select p.id, p.name, p.duties, p.aliases
      from public.people p
     where cardinality(p.duties) > 0
     order by p.name, p.id;
end;
$$;
comment on function public.duty_people() is
  'People with any duty (id, name, duties, aliases) for the roster pickers. Editor/admin or can_edit_privilegios.';

-- ---------------------------------------------------------------------------
-- list_accounts: + can_edit_programa, can_edit_privilegios (raw stored flags)
-- ---------------------------------------------------------------------------
drop function public.list_accounts();

create function public.list_accounts()
returns table (
  user_id              uuid,
  email                text,
  display_name         text,
  avatar_url           text,
  provider             text,
  role                 text,
  person_id            uuid,
  person_name          text,
  created_at           timestamptz,
  can_edit_programa    boolean,
  can_edit_privilegios boolean
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
      coalesce(pr.can_edit_programa, false),
      coalesce(pr.can_edit_privilegios, false)
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.people p on p.id = pr.person_id
    order by u.created_at desc;
end;
$$;
comment on function public.list_accounts() is
  'Every auth user with role, linked person and the stored programa/privilegios grants. Editor/admin only.';

-- ---------------------------------------------------------------------------
-- The assignment feed: + kind 'privilegio'
-- ---------------------------------------------------------------------------
create or replace function private.assignments_for_person(p_person uuid, p_from date, p_to date)
returns table (
  key        text,
  kind       text,
  date       date,
  start_time text,
  title      text,
  place      text,
  role       text,
  detail     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with names as (
    select private.person_match_names(p_person) as n
  ),
  -- Carrito: matched by id (person_ids), one row per cell, skipping blacked-out dates.
  carrito as (
    select
      'carrito:' || a.id || ':' || d.day as key,
      'carrito'::text as kind,
      d.day as date,
      to_char(s.start_time, 'HH24:MI') as start_time,
      pl.name as title,
      pl.name as place,
      null::text as role,
      nullif(concat_ws(' · ',
        nullif(array_to_string(array(
          select u.nm
            from unnest(a.person_ids, a.person_names) with ordinality as u (pid, nm, ord)
           where u.pid <> p_person
           order by u.ord), ', '), ''),
        nullif(trim(a.note), '')), '') as detail
    from public.cart_assignments a
    join public.cart_slots s on s.id = a.slot_id
    join public.cart_places pl on pl.id = s.place_id
    cross join lateral (select a.week_date + (s.iso_dow - 1) as day) d
    where a.person_ids @> array[p_person]
      and d.day between p_from and p_to
      and not exists (
        select 1 from public.cart_blackouts b where b.slot_id = s.id and b.date = d.day)
  ),
  -- Programa (midweek): parts[].people[] matched by name.
  midweek as (
    select distinct on (w.date, pt.idx)
      'programa:midweek:' || w.date || ':' || (pt.idx - 1) as key,
      'programa'::text as kind,
      w.date,
      nullif(pt.part ->> 'time', '') as start_time,
      coalesce(nullif(pt.part ->> 'title', ''), 'Reunión') as title,
      null::text as place,
      nullif(pp.person ->> 'role', '') as role,
      null::text as detail
    from public.program_weeks w
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.data -> 'parts') = 'array' then w.data -> 'parts' else '[]'::jsonb end
    ) with ordinality as pt (part, idx)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(pt.part -> 'people') = 'array' then pt.part -> 'people' else '[]'::jsonb end
    ) with ordinality as pp (person, pidx)
    cross join names
    where w.kind = 'midweek'
      and w.date between p_from and p_to
      and private.norm_name(pp.person ->> 'name') = any (names.n)
    order by w.date, pt.idx, pp.pidx
  ),
  -- Programa (weekend): fixed fields.
  weekend as (
    select
      'programa:weekend:' || w.date || ':' || f.field as key,
      'programa'::text as kind,
      w.date,
      null::text as start_time,
      f.title,
      null::text as place,
      f.role,
      null::text as detail
    from public.program_weeks w
    cross join lateral (values
      (1, 'presidente',   w.data ->> 'presidente',              'Presidencia',                                                  'Presidente'),
      (2, 'conductor',    w.data ->> 'conductor',               'Estudio de La Atalaya',                                        'Conductor'),
      (3, 'lector',       w.data ->> 'lector',                  'Estudio de La Atalaya',                                        'Lector'),
      (4, 'orador',       w.data #>> '{discurso,orador}',       coalesce(nullif(w.data #>> '{discurso,titulo}', ''), 'Discurso'), 'Orador'),
      (5, 'oracionFinal', w.data ->> 'oracionFinal',            'Oración final',                                                'Oración')
    ) as f (ord, field, who, title, role)
    cross join names
    where w.kind = 'weekend'
      and w.date between p_from and p_to
      and private.norm_name(f.who) = any (names.n)
  ),
  -- Salidas: conductor matched by name. week_start is Monday, dow 0 = Sunday (+6).
  salida as (
    select
      'salida:' || m.id as key,
      'salida'::text as kind,
      d.day as date,
      nullif(trim(m.start_time), '') as start_time,
      coalesce(nullif(trim(m.place), ''), 'Salida') as title,
      nullif(trim(m.place), '') as place,
      'Conductor'::text as role,
      nullif(trim(m.groups), '') as detail
    from public.service_meetings m
    join public.service_weeks sw on sw.id = m.week_id
    cross join lateral (select sw.week_start + ((m.dow + 6) % 7) as day) d
    cross join names
    where d.day between p_from and p_to
      and private.norm_name(m.conductor) = any (names.n)
  ),
  -- Privilegios: by id, or by name for free-text cells. Assembly / no-meeting days skipped.
  -- The meeting time is not stored, so start_time stays null.
  privilegio as (
    select
      'privilegio:' || r.date || ':' || r.role || ':' || r.slot as key,
      'privilegio'::text as kind,
      r.date,
      null::text as start_time,
      case r.role
        when 'computadora' then 'Computadora'
        when 'sonido' then 'Sonido'
        when 'microfonista' then 'Micrófono'
        else 'Acomodador'
      end as title,
      null::text as place,
      null::text as role,
      nullif(trim(r.note), '') as detail
    from public.duty_roster r
    cross join names
    where r.date between p_from and p_to
      and (r.person_id = p_person
           or (r.person_id is null and private.norm_name(r.person_name) = any (names.n)))
      and not exists (
        select 1 from public.duty_days dd
         where dd.date = r.date and dd.kind in ('asamblea', 'sin_reunion'))
  )
  select * from carrito
  union all select * from midweek
  union all select * from weekend
  union all select * from salida
  union all select * from privilegio;
$$;
comment on function private.assignments_for_person(uuid, date, date) is
  'Carrito turns (by id), program parts and salidas conducted (by name or alias) and privilegios (by id or name) of one person between two dates.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;

-- RLS policies call these three as the requesting role. Every other private function stays
-- revoked, and `private` is not in the API's exposed schemas (config.toml).
grant usage on schema private to authenticated;
grant execute on function private.can_edit_programa() to authenticated;
grant execute on function private.can_edit_privilegios() to authenticated;
grant execute on function private.sees_privilegios() to authenticated;

revoke all on function public.name_sources() from public, anon;
revoke all on function public.create_person_from_name(text, text, boolean) from public, anon;
revoke all on function public.add_person_alias(uuid, text) from public, anon;
revoke all on function public.set_account_permissions(uuid, boolean, boolean) from public, anon;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.duty_people() from public, anon;
revoke all on function public.list_accounts() from public, anon;

grant execute on function public.name_sources() to authenticated;
grant execute on function public.create_person_from_name(text, text, boolean) to authenticated;
grant execute on function public.add_person_alias(uuid, text) to authenticated;
grant execute on function public.set_account_permissions(uuid, boolean, boolean) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.duty_people() to authenticated;
grant execute on function public.list_accounts() to authenticated;
