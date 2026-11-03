-- Weekend speakers.
--   * discurso.orador (the incoming speaker) is a visiting speaker, plain free text, never
--     linked to the directory: it no longer feeds the member assignment feed / reminders
--     (assignments_for_person) nor the "names to link" list (name_sources).
--   * discursantesSalientes[] entries become {name, person_id?, congregacion}; the column is
--     jsonb, so there is no DDL. Old data (string or {name, person_id}) keeps being read.
-- Both functions are redefined unchanged except for the dropped orador row; grants are kept.

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
