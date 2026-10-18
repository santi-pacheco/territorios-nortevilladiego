-- Schedule entries link to people by id (Mis asignaciones and reminders match by link, not by
-- spelling). Names stay as display snapshots; legacy entries without an id keep matching by
-- name or alias exactly as before.
--
--   service_meetings.conductor_person_id   salida conductor link (conductor text = snapshot, trigger)
--   program_weeks.data                     midweek parts[].people[] = {name, role?, person_id?}
--                                          weekend presidente / conductor / lector / oracionFinal and
--                                          discurso.orador = 'Name' (legacy) or {name, person_id?}
--   private.program_person_name / program_person_id / live_person_id   jsonb person helpers
--   private.assignments_for_person         by id when linked, else by name/alias
--   public.name_sources                    linked entries are no longer listed
--   public.people_directory                person picker feed (editors, programa, privilegios)
--   public.create_person_from_name         + programa/privilegios callers, + p_duties

-- ---------------------------------------------------------------------------
-- Salida conductor link
-- ---------------------------------------------------------------------------
alter table public.service_meetings
  add column conductor_person_id uuid references public.people (id) on delete set null;
create index service_meetings_conductor_person_id_idx
  on public.service_meetings (conductor_person_id);
comment on column public.service_meetings.conductor_person_id is
  'The person conducting (null = free text / legacy). When set, conductor is kept equal to people.name (trigger).';
comment on column public.service_meetings.conductor is
  'Display snapshot of the conductor: people.name when conductor_person_id is set (trigger), free text otherwise.';

-- DEFINER for symmetry with fill_duty_person_name: the name must come from people even if the
-- writer could not read it under RLS.
create or replace function private.fill_meeting_conductor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.conductor_person_id is not null then
    select p.name into v_name from public.people p where p.id = new.conductor_person_id;
    if v_name is null then
      raise exception 'service_meetings.conductor_person_id references an unknown person' using errcode = '23503';
    end if;
    new.conductor := v_name;
  end if;
  return new;
end;
$$;
comment on function private.fill_meeting_conductor() is
  'BEFORE INSERT/UPDATE on service_meetings: conductor = people.name when conductor_person_id is set.';

create trigger service_meetings_fill_conductor
  before insert or update of conductor, conductor_person_id on public.service_meetings
  for each row execute function private.fill_meeting_conductor();

create or replace function private.sync_meetings_from_people()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.service_meetings
     set conductor_person_id = conductor_person_id  -- re-fires fill_meeting_conductor
   where conductor_person_id = new.id;
  return new;
end;
$$;

create trigger people_sync_service_meetings
  after update of name on public.people
  for each row
  when (new.name is distinct from old.name)
  execute function private.sync_meetings_from_people();

-- ---------------------------------------------------------------------------
-- Program person helpers. A person value in program_weeks.data is a JSON string (legacy) or an
-- object {name, person_id?}. Never cast an unchecked person_id: a bad value in one week must
-- not break my_assignments / reminder_candidates for everyone.
-- ---------------------------------------------------------------------------
create or replace function private.program_person_name(v jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case jsonb_typeof(v)
    when 'string' then v #>> '{}'
    when 'object' then v ->> 'name'
  end;
$$;
comment on function private.program_person_name(jsonb) is
  'Name of a program person value: the string itself, or ->>name of an object. Null otherwise.';

create or replace function private.program_person_id(v jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(v ->> 'person_id')
   where jsonb_typeof(v) = 'object'
     and (v ->> 'person_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
comment on function private.program_person_id(jsonb) is
  'person_id of an object program person value when it is a well-formed uuid (as text), else null.';

-- The linked person, if it still exists (jsonb has no FK: a deleted person leaves a dangling id,
-- which then counts as unlinked and falls back to name matching).
create or replace function private.live_person_id(v jsonb)
returns uuid
language sql
stable
parallel safe
set search_path = ''
as $$
  select p.id
    from public.people p
   where p.id = (private.program_person_id(v))::uuid;
$$;
comment on function private.live_person_id(jsonb) is
  'people.id linked by a program person value, null when unlinked or the person no longer exists.';

-- ---------------------------------------------------------------------------
-- The assignment feed: by id when linked, else by name/alias
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
  -- Programa (midweek): parts[].people[] by person_id, else by name.
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
    cross join lateral (select private.live_person_id(pp.person) as pid) l
    cross join names
    where w.kind = 'midweek'
      and w.date between p_from and p_to
      and (l.pid = p_person
           or (l.pid is null and private.norm_name(pp.person ->> 'name') = any (names.n)))
    order by w.date, pt.idx, pp.pidx
  ),
  -- Programa (weekend): fixed fields, each a string (legacy) or {name, person_id?}.
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
      (1, 'presidente',   w.data -> 'presidente',              'Presidencia',                                                  'Presidente'),
      (2, 'conductor',    w.data -> 'conductor',               'Estudio de La Atalaya',                                        'Conductor'),
      (3, 'lector',       w.data -> 'lector',                  'Estudio de La Atalaya',                                        'Lector'),
      (4, 'orador',       w.data #> '{discurso,orador}',       coalesce(nullif(w.data #>> '{discurso,titulo}', ''), 'Discurso'), 'Orador'),
      (5, 'oracionFinal', w.data -> 'oracionFinal',            'Oración final',                                                'Oración')
    ) as f (ord, field, who, title, role)
    cross join lateral (select private.live_person_id(f.who) as pid) l
    cross join names
    where w.kind = 'weekend'
      and w.date between p_from and p_to
      and (l.pid = p_person
           or (l.pid is null and private.norm_name(private.program_person_name(f.who)) = any (names.n)))
  ),
  -- Salidas: conductor by conductor_person_id, else by name. week_start is Monday, dow 0 = Sunday (+6).
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
      and (m.conductor_person_id = p_person
           or (m.conductor_person_id is null and private.norm_name(m.conductor) = any (names.n)))
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
  'Carrito turns (by id); program parts, salidas conducted and privilegios by person id when linked, else by name or alias; between two dates.';

-- ---------------------------------------------------------------------------
-- name_sources: only entries without a (live) person link
-- ---------------------------------------------------------------------------
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
         and private.live_person_id(pp.person) is null
      union all
      select private.program_person_name(f.who), 'programa', w.date
        from public.program_weeks w
        cross join lateral (values
          (w.data -> 'presidente'),
          (w.data -> 'conductor'),
          (w.data -> 'lector'),
          (w.data #> '{discurso,orador}'),
          (w.data -> 'oracionFinal')
        ) as f (who)
       where w.kind = 'weekend'
         and private.live_person_id(f.who) is null
      union all
      select m.conductor, 'salida', sw.week_start + ((m.dow + 6) % 7)
        from public.service_meetings m
        join public.service_weeks sw on sw.id = m.week_id
       where m.conductor_person_id is null
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
  'Distinct names of program, salida and roster entries WITHOUT a person link, with the person they match by name or alias (or null). Editor/admin only.';

-- ---------------------------------------------------------------------------
-- Person picker feed
-- ---------------------------------------------------------------------------
create or replace function public.people_directory()
returns table (id uuid, name text, aliases text[], duties text[], in_carrito boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_editor() or private.can_edit_programa() or private.can_edit_privilegios()) then
    raise exception 'people_directory: editor, programa or privilegios permission required'
      using errcode = '42501';
  end if;

  return query
    select p.id, p.name, p.aliases, p.duties, p.in_carrito
      from public.people p
     order by p.name, p.id;
end;
$$;
comment on function public.people_directory() is
  'Everyone (id, name, aliases, duties, in_carrito) for the schedule person pickers. Editor/admin, can_edit_programa or can_edit_privilegios.';

-- ---------------------------------------------------------------------------
-- create_person_from_name: + programa/privilegios callers, + p_duties.
-- Dropped and recreated (a new defaulted argument via create-or-replace would add an overload,
-- which PostgREST cannot disambiguate).
-- ---------------------------------------------------------------------------
drop function public.create_person_from_name(text, text, boolean);

create function public.create_person_from_name(
  p_name text,
  p_gender text,
  p_in_carrito boolean default false,
  p_duties text[] default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_editor boolean := public.is_editor();
  v_privilegios boolean := private.can_edit_privilegios();
  v_id uuid;
begin
  if not (v_editor or v_privilegios or private.can_edit_programa()) then
    raise exception 'create_person_from_name: editor, programa or privilegios permission required'
      using errcode = '42501';
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

  -- Only editors manage the carrito roster; only privilegios editors tag duties.
  insert into public.people (name, gender, in_carrito, duties)
  values (
    v_name,
    p_gender,
    v_editor and coalesce(p_in_carrito, false),
    case when v_privilegios then coalesce(p_duties, '{}') else '{}' end
  )
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.create_person_from_name(text, text, boolean, text[]) is
  'Create a person from a typed name (returns the id). 23505 if the name or an alias already matches someone. Editor/admin, can_edit_programa or can_edit_privilegios; in_carrito only for editors, duties only with privilegios permission.';

-- ---------------------------------------------------------------------------
-- Grants. Revoke the new private helpers one by one: a blanket revoke on schema private
-- would also strip the RLS helpers granted to authenticated.
-- ---------------------------------------------------------------------------
revoke all on function private.fill_meeting_conductor() from public, anon, authenticated;
revoke all on function private.sync_meetings_from_people() from public, anon, authenticated;
revoke all on function private.program_person_name(jsonb) from public, anon, authenticated;
revoke all on function private.program_person_id(jsonb) from public, anon, authenticated;
revoke all on function private.live_person_id(jsonb) from public, anon, authenticated;

revoke all on function public.people_directory() from public, anon;
revoke all on function public.create_person_from_name(text, text, boolean, text[]) from public, anon;
grant execute on function public.people_directory() to authenticated;
grant execute on function public.create_person_from_name(text, text, boolean, text[]) to authenticated;
