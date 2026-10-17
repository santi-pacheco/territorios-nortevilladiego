-- Member accounts, "Mis asignaciones" and reminders (contract: docs/ASSIGNMENTS.md).
--
--   profiles.person_id     link an auth user to a people row (editor RPCs only)
--   people.aliases         other spellings of a name (program PDFs, salida conductor)
--   on_auth_user_created   every new auth user gets a viewer profile
--   private.norm_name / private.assignments_for_person   name matching + the assignment feed
--   public.my_assignments / my_link                       member RPCs
--   public.list_accounts / link_account / set_account_role editor/admin RPCs
--   public.reminder_log    what the send-reminders Edge Function already pushed (no client access)
--   public.reminder_candidates                            server-only feed for the sender
--   cron job send-reminders                               daily 12:00 UTC via pg_net, URL/secret from Vault

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_cron;
-- pg_net puts its functions in schema `net` either way; this only keeps it out of `public`.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column person_id uuid unique references public.people (id) on delete set null;
comment on column public.profiles.person_id is
  'The people row this account belongs to. Written only by public.link_account() (no column grant).';

alter table public.people
  add column aliases text[] not null default '{}'
    check (cardinality(aliases) <= 20 and pg_column_size(aliases) <= 4096);
comment on column public.people.aliases is
  'Other spellings of the name as they appear in program PDFs or as salida conductor (e.g. "D. Gomez").';

-- ---------------------------------------------------------------------------
-- New auth user → viewer profile. Must never raise: a failure here blocks sign-in.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    'viewer',
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 80), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function private.handle_new_user() is
  'AFTER INSERT on auth.users: creates profiles(id, role viewer, display_name = full_name).';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Name matching
-- ---------------------------------------------------------------------------
-- Two-argument unaccent: the one-argument form resolves the dictionary through search_path.
create or replace function private.norm_name(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, trim(coalesce(p, '')))),
    '\s+', ' ', 'g'
  );
$$;
comment on function private.norm_name(text) is 'lower(unaccent(trim(x))) with runs of whitespace collapsed to one space.';

-- Normalised name + aliases of a person (empty strings dropped).
create or replace function private.person_match_names(p_person uuid)
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct n) filter (where n <> ''), '{}')
    from public.people p
    cross join lateral unnest(array_prepend(p.name, p.aliases)) as a (raw)
    cross join lateral (select private.norm_name(a.raw) as n) x
   where p.id = p_person;
$$;

-- ---------------------------------------------------------------------------
-- The assignment feed for one person
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
  )
  select * from carrito
  union all select * from midweek
  union all select * from weekend
  union all select * from salida;
$$;
comment on function private.assignments_for_person(uuid, date, date) is
  'Carrito turns (by id), program parts and salidas conducted (by name or alias) of one person between two dates.';

-- ---------------------------------------------------------------------------
-- Member RPCs
-- ---------------------------------------------------------------------------
create or replace function public.my_assignments(
  p_from date default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  p_to   date default (now() at time zone 'America/Argentina/Buenos_Aires')::date + 90
)
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
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'my_assignments: invalid range' using errcode = '22023';
  end if;

  select pr.person_id into v_person
    from public.profiles pr
   where pr.id = (select auth.uid());

  if v_person is null then
    return;
  end if;

  return query
    select a.key, a.kind, a.date, a.start_time, a.title, a.place, a.role, a.detail
      from private.assignments_for_person(v_person, p_from, p_to) a
     order by a.date, a.start_time nulls last, a.kind, a.key;
end;
$$;
comment on function public.my_assignments(date, date) is
  'Assignments of the caller''s linked person (profiles.person_id). Empty when not linked.';

create or replace function public.my_link()
returns table (person_id uuid, person_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name
    from public.profiles pr
    join public.people p on p.id = pr.person_id
   where pr.id = (select auth.uid());
$$;
comment on function public.my_link() is 'The people row linked to the caller (zero rows when not linked).';

-- ---------------------------------------------------------------------------
-- Editor / admin RPCs
-- ---------------------------------------------------------------------------
create or replace function public.list_accounts()
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  avatar_url   text,
  provider     text,
  role         text,
  person_id    uuid,
  person_name  text,
  created_at   timestamptz
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
      u.created_at
    from auth.users u
    left join public.profiles pr on pr.id = u.id
    left join public.people p on p.id = pr.person_id
    order by u.created_at desc;
end;
$$;
comment on function public.list_accounts() is 'Every auth user with role and linked person. Editor/admin only.';

create or replace function public.link_account(p_user uuid, p_person uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_editor() then
    raise exception 'link_account: editor role required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'link_account: unknown user' using errcode = 'P0002';
  end if;
  if p_person is not null and not exists (select 1 from public.people p where p.id = p_person) then
    raise exception 'link_account: unknown person' using errcode = 'P0002';
  end if;
  if p_person is not null and exists (
    select 1 from public.profiles pr where pr.person_id = p_person and pr.id <> p_user
  ) then
    raise exception 'Esa persona ya está vinculada a otra cuenta' using errcode = '23505';
  end if;

  insert into public.profiles as pr (id, role, person_id)
  values (p_user, 'viewer', p_person)
  on conflict (id) do update set person_id = excluded.person_id
   where pr.person_id is distinct from excluded.person_id;
end;
$$;
comment on function public.link_account(uuid, uuid) is 'Link an account to a people row (null unlinks). Editor/admin only.';

create or replace function public.set_account_role(p_user uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admins int;
  v_current text;
begin
  if not public.is_admin() then
    raise exception 'set_account_role: admin role required' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('viewer', 'editor', 'admin') then
    raise exception 'set_account_role: invalid role %', p_role using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'set_account_role: unknown user' using errcode = 'P0002';
  end if;

  -- Serialise concurrent demotions: lock every admin row before counting.
  perform 1 from public.profiles pr where pr.role = 'admin' for update;
  select pr.role into v_current from public.profiles pr where pr.id = p_user;

  if v_current = 'admin' and p_role <> 'admin' then
    select count(*) into v_admins from public.profiles pr where pr.role = 'admin';
    if v_admins <= 1 then
      raise exception 'No se puede quitar el último administrador' using errcode = '42501';
    end if;
  end if;

  insert into public.profiles as pr (id, role)
  values (p_user, p_role)
  on conflict (id) do update set role = excluded.role
   where pr.role is distinct from excluded.role;
end;
$$;
comment on function public.set_account_role(uuid, text) is 'Change an account role. Admin only; the last admin cannot be demoted.';

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create table public.reminder_log (
  user_id        uuid not null references auth.users (id) on delete cascade,
  assignment_key text not null check (char_length(assignment_key) <= 200),
  offset_days    integer not null check (offset_days between 0 and 60),
  sent_at        timestamptz not null default now(),
  primary key (user_id, assignment_key, offset_days)
);
comment on table public.reminder_log is
  'One row per reminder pushed by the send-reminders Edge Function. Append-only log: no version/updated_* columns, no client access.';

alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from public, anon, authenticated;

-- Server-only feed for the sender: assignments between two dates of every linked user that
-- has at least one web push subscription. The secret key calls it through PostgREST.
create or replace function public.reminder_candidates(p_from date, p_to date)
returns table (
  user_id    uuid,
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
security definer
set search_path = ''
as $$
  select pr.id, a.key, a.kind, a.date, a.start_time, a.title, a.place, a.role, a.detail
    from public.profiles pr
    cross join lateral private.assignments_for_person(pr.person_id, p_from, p_to) a
   where pr.person_id is not null
     and p_to - p_from between 0 and 31
     and exists (
       select 1 from public.device_tokens t where t.user_id = pr.id and t.platform = 'web')
   order by pr.id, a.date, a.key;
$$;
comment on function public.reminder_candidates(date, date) is
  'Server only (secret key, send-reminders): assignments of linked users with web push subscriptions. Not executable by anon/authenticated.';

-- Daily cron → Edge Function. URL and shared secret come from Vault so nothing secret is in git.
create or replace function private.invoke_send_reminders()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'reminders_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'reminders_secret';
  if v_url is null or v_secret is null then
    raise notice 'send-reminders skipped: Vault secrets reminders_url / reminders_secret not set';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
comment on function private.invoke_send_reminders() is
  'Called by pg_cron daily at 12:00 UTC (09:00 Buenos Aires). No-op until the Vault secrets exist.';

select cron.schedule('send-reminders', '0 12 * * *', 'select private.invoke_send_reminders()');

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function public.my_assignments(date, date) from public, anon;
revoke all on function public.my_link() from public, anon;
revoke all on function public.list_accounts() from public, anon;
revoke all on function public.link_account(uuid, uuid) from public, anon;
revoke all on function public.set_account_role(uuid, text) from public, anon;
revoke all on function public.reminder_candidates(date, date) from public, anon, authenticated;

grant execute on function public.my_assignments(date, date) to authenticated;
grant execute on function public.my_link() to authenticated;
grant execute on function public.list_accounts() to authenticated;
grant execute on function public.link_account(uuid, uuid) to authenticated;
grant execute on function public.set_account_role(uuid, text) to authenticated;
