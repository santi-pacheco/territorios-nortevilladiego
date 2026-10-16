-- TerritoriosMap 2.0 schema (new Supabase project, NOT shared with v1).
--
-- Every app table carries:
--   updated_at  timestamptz  set by trigger on every write
--   version     int          1 on insert, +1 on every update (trigger; client values ignored)
--   updated_by  uuid         auth.uid() of the writer (trigger; client values ignored for
--                            authenticated users, kept for server-key/import writes)
--
-- `version` is the compare-and-swap token. Clients update with
--   update ... set ... where id = $id and version = $expected returning *
-- and treat 0 returned rows as a conflict. See supabase/README.md.
--
-- RLS, grants and policies live in the next migration (rls_policies).

create schema if not exists private;
comment on schema private is 'Internal helpers (trigger functions). Not exposed through the Data API.';
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: version / updated_at / updated_by
-- ---------------------------------------------------------------------------
create or replace function private.bump_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  -- Authenticated writers cannot spoof authorship. Server-key / postgres
  -- writes (auth.uid() is null) keep whatever the import provided.
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

comment on function private.bump_version() is
  'BEFORE INSERT/UPDATE trigger: forces version (1, then old+1), updated_at=now(), updated_by=auth.uid().';

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. role drives every write policy.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         text not null default 'viewer' check (role in ('viewer', 'editor', 'admin')),
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.profiles is
  'Role per auth user. Rows are created/changed only by the owner (SQL editor / service role). Users can read their own row and edit display_name.';

-- ---------------------------------------------------------------------------
-- Territories (imported from KML). id = first integer in the Placemark name.
-- ---------------------------------------------------------------------------
create table public.territories (
  id           integer primary key check (id > 0),
  name         text not null check (char_length(name) between 1 and 120),
  geometry     jsonb not null,
  centroid_lng double precision not null check (centroid_lng between -180 and 180),
  centroid_lat double precision not null check (centroid_lat between -90 and 90),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null,
  constraint territories_geometry_shape check (
    jsonb_typeof(geometry) = 'object'
    and geometry ->> 'type' in ('Polygon', 'MultiPolygon')
    and jsonb_typeof(geometry -> 'coordinates') = 'array'
  ),
  constraint territories_geometry_size check (pg_column_size(geometry) <= 262144)
);
comment on table public.territories is 'Territory polygons (GeoJSON Polygon/MultiPolygon geometry) imported from the KML.';

-- ---------------------------------------------------------------------------
-- Salidas (field service): one week, many meetings
-- ---------------------------------------------------------------------------
create table public.service_weeks (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null unique check (extract(isodow from week_start) = 1),
  month_label text not null default '' check (char_length(month_label) <= 40),
  updated_at  timestamptz not null default now(),
  version     integer not null default 1,
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.service_weeks is 'A Salidas week (Mon-Sun).';
comment on column public.service_weeks.week_start is
  'MONDAY of the Mon-Sun week. v1 stored a Wednesday reference (weekStart); the v1 importer converts it with weekStart - 2 days. Day numbers are derived from this date.';
comment on column public.service_weeks.month_label is 'Free-text month label printed on the card (v1 "mes").';

create table public.service_meetings (
  id                uuid primary key default gen_random_uuid(),
  week_id           uuid not null references public.service_weeks (id) on delete cascade,
  dow               smallint not null check (dow between 0 and 6),
  position          smallint not null default 0 check (position between 0 and 99),
  kind              text not null default 'normal' check (kind in ('normal', 'domingo')),
  start_time        text not null default '' check (char_length(start_time) <= 20),
  groups            text not null default '' check (char_length(groups) <= 120),
  conductor         text not null default '' check (char_length(conductor) <= 120),
  place             text not null default '' check (char_length(place) <= 200),
  territory_ids     integer[] not null default '{}' check (cardinality(territory_ids) <= 60),
  group_territories jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,
  updated_by        uuid default auth.uid() references auth.users (id) on delete set null,
  -- Domingo always lives on Sunday (JS dow 0), everything else is 'normal'.
  constraint service_meetings_kind_dow check ((kind = 'domingo') = (dow = 0)),
  -- Per-group (G1-G4) territory layout, Domingo only:
  --   {"G1": [12], "G2": [13, 14], "G3": [], "G4": [20]}
  constraint service_meetings_group_territories_shape check (
    jsonb_typeof(group_territories) = 'object'
    and (group_territories - array['G1', 'G2', 'G3', 'G4']) = '{}'::jsonb
    and (kind = 'domingo' or group_territories = '{}'::jsonb)
  ),
  constraint service_meetings_group_territories_size check (pg_column_size(group_territories) <= 4096)
);
create index service_meetings_week_id_idx on public.service_meetings (week_id, dow, position);
comment on table public.service_meetings is 'One salida (meeting point) in a week. dow uses JS numbering 0=Dom..6=Sab (Salidas/Mapa system).';
comment on column public.service_meetings.territory_ids is 'Territories worked from this salida (normal days).';
comment on column public.service_meetings.group_territories is 'Domingo only: per-group territory ids, keys G1..G4, values arrays of territory ids.';

-- ---------------------------------------------------------------------------
-- Carrito (cart witnessing)
-- ---------------------------------------------------------------------------
create table public.cart_places (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  color      text not null default '#888888' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);

create table public.cart_slots (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references public.cart_places (id) on delete cascade,
  iso_dow       smallint not null check (iso_dow between 1 and 7),
  start_time    time not null,
  end_time      time not null,
  group_size    smallint not null default 2 check (group_size between 1 and 12),
  display_label text check (display_label is null or char_length(display_label) <= 80),
  updated_at    timestamptz not null default now(),
  version       integer not null default 1,
  updated_by    uuid default auth.uid() references auth.users (id) on delete set null,
  constraint cart_slots_time_order check (end_time > start_time)
);
create index cart_slots_place_id_idx on public.cart_slots (place_id);
comment on column public.cart_slots.iso_dow is 'ISO day of week 1=Lun..7=Dom (Carrito system; differs from service_meetings.dow on purpose).';

create table public.people (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 120),
  gender             text not null check (gender in ('M', 'F')),
  target_appearances integer not null default 0 check (target_appearances between 0 and 999),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  updated_by         uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.people is 'Carrito roster. PII: readable by editor/admin only.';
comment on column public.people.target_appearances is '0 means unlimited (scheduler treats it as 999). The v1 importer clamps negative values to 0.';

create table public.person_availability (
  person_id  uuid not null references public.people (id) on delete cascade,
  slot_id    uuid not null references public.cart_slots (id) on delete cascade,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (person_id, slot_id)
);
create index person_availability_slot_id_idx on public.person_availability (slot_id);

-- Symmetric "must be with": one row per unordered pair, stored with person_a < person_b.
create table public.person_pairs (
  person_a   uuid not null references public.people (id) on delete cascade,
  person_b   uuid not null references public.people (id) on delete cascade,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (person_a, person_b),
  constraint person_pairs_ordered check (person_a < person_b)
);
create index person_pairs_person_b_idx on public.person_pairs (person_b);
comment on table public.person_pairs is 'Symmetric must-be-with pairs. Stored once with person_a < person_b (a trigger normalizes order on write).';

create or replace function private.normalize_person_pair()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tmp uuid;
begin
  if new.person_a > new.person_b then
    tmp := new.person_a;
    new.person_a := new.person_b;
    new.person_b := tmp;
  end if;
  return new;
end;
$$;

create trigger person_pairs_normalize
  before insert or update on public.person_pairs
  for each row execute function private.normalize_person_pair();

create table public.cart_schedules (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '' check (char_length(name) <= 120),
  start_date date not null,
  end_date   date not null,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint cart_schedules_range check (end_date >= start_date and end_date - start_date <= 400)
);

-- One cell of the cronograma grid. person_names is a trigger-maintained snapshot
-- of people.name so the public grid can show who is scheduled without exposing
-- the people table (gender, availability, pairs stay editor-only).
create table public.cart_assignments (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.cart_schedules (id) on delete cascade,
  slot_id      uuid not null references public.cart_slots (id) on delete cascade,
  week_date    date not null check (extract(isodow from week_date) = 1),
  person_ids   uuid[] not null default '{}' check (cardinality(person_ids) <= 12),
  person_names text[] not null default '{}',
  note         text check (note is null or char_length(note) <= 500),
  updated_at   timestamptz not null default now(),
  version      integer not null default 1,
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null,
  constraint cart_assignments_cell_unique unique (schedule_id, week_date, slot_id),
  constraint cart_assignments_names_match check (cardinality(person_names) = cardinality(person_ids))
);
create index cart_assignments_slot_id_idx on public.cart_assignments (slot_id);
create index cart_assignments_person_ids_idx on public.cart_assignments using gin (person_ids);
comment on column public.cart_assignments.week_date is 'Monday of the week (scheduler anchor).';
comment on column public.cart_assignments.person_names is 'Derived from people.name by trigger; client-supplied values are ignored.';

-- Validates person_ids (exist, no duplicates) and fills person_names in order.
create or replace function private.fill_assignment_names()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  names text[];
begin
  if cardinality(new.person_ids) <> (select count(distinct x) from unnest(new.person_ids) as x) then
    raise exception 'cart_assignments.person_ids contains duplicates' using errcode = '23514';
  end if;

  select coalesce(array_agg(p.name order by u.ord), '{}')
    into names
    from unnest(new.person_ids) with ordinality as u (id, ord)
    join public.people p on p.id = u.id;

  if cardinality(names) <> cardinality(new.person_ids) then
    raise exception 'cart_assignments.person_ids references unknown people' using errcode = '23503';
  end if;

  new.person_names := names;
  return new;
end;
$$;

create trigger cart_assignments_fill_names
  before insert or update on public.cart_assignments
  for each row execute function private.fill_assignment_names();

-- Keep the snapshot in sync when a person is renamed or deleted.
create or replace function private.sync_assignments_from_people()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.cart_assignments
       set person_ids = array_remove(person_ids, old.id)
     where person_ids @> array[old.id];
    return old;
  end if;

  if new.name is distinct from old.name then
    update public.cart_assignments
       set person_ids = person_ids  -- re-fires fill_assignment_names
     where person_ids @> array[new.id];
  end if;
  return new;
end;
$$;

create trigger people_sync_assignments
  after update or delete on public.people
  for each row execute function private.sync_assignments_from_people();

create table public.cart_blackouts (
  id         uuid primary key default gen_random_uuid(),
  slot_id    uuid not null references public.cart_slots (id) on delete cascade,
  date       date not null,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint cart_blackouts_unique unique (slot_id, date)
);
comment on table public.cart_blackouts is 'A slot cancelled on one specific date (v1 "excepciones").';

-- ---------------------------------------------------------------------------
-- Programa: one row per meeting, keyed by ISO date. data validated by Zod in the app.
-- ---------------------------------------------------------------------------
create table public.program_weeks (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('midweek', 'weekend')),
  date       date not null,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  constraint program_weeks_unique unique (kind, date),
  -- midweek keyed by Tuesday, weekend keyed by Saturday (must-preserve rule).
  constraint program_weeks_key_day check (
    (kind = 'midweek' and extract(isodow from date) = 2)
    or (kind = 'weekend' and extract(isodow from date) = 6)
  ),
  constraint program_weeks_data_shape check (jsonb_typeof(data) = 'object'),
  constraint program_weeks_data_size check (pg_column_size(data) <= 65536)
);
comment on column public.program_weeks.data is 'MidweekWeek or WeekendMeeting payload (shape validated by Zod in packages/core).';

-- ---------------------------------------------------------------------------
-- Push device tokens: each user manages only their own.
-- ---------------------------------------------------------------------------
create table public.device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token      text not null unique check (char_length(token) between 10 and 4096),
  platform   text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index device_tokens_user_id_idx on public.device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Attach bump_version to every table.
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
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function private.bump_version()',
      t || '_bump_version', t
    );
  end loop;
end;
$$;
