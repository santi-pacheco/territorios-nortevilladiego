-- Schema invariants: RLS coverage, common columns, version trigger, constraints, derived data.
-- Runs as postgres inside a transaction that is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Coverage
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every table in public has RLS enabled'
);

select is(
  (select count(*)::int from pg_tables where schemaname = 'public'),
  15,
  'public has exactly the 15 planned tables'
);

select is(
  (select count(*)::int
     from pg_tables t
    where t.schemaname = 'public'
      and t.tablename <> 'reminder_log'  -- append-only log, no CAS
      and (select count(*) from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t.tablename
              and c.column_name in ('updated_at', 'version', 'updated_by')) <> 3),
  0,
  'every public table has updated_at, version, updated_by'
);

select is(
  (select count(*)::int
     from pg_tables t
    where t.schemaname = 'public'
      and t.tablename <> 'reminder_log'
      and not exists (select 1 from pg_trigger g
                       where g.tgrelid = format('public.%I', t.tablename)::regclass
                         and g.tgname = t.tablename || '_bump_version')),
  0,
  'every public table has the bump_version trigger'
);

-- ---------------------------------------------------------------------------
-- Version trigger
-- ---------------------------------------------------------------------------
insert into public.cart_places (id, name, color, version)
values ('00000000-0000-4000-8000-00000000f001', 'Lugar Test', '#123456', 50);

select is(
  (select version from public.cart_places where id = '00000000-0000-4000-8000-00000000f001'),
  1,
  'insert forces version = 1 (client value ignored)'
);

update public.cart_places set name = 'Lugar Test 2' where id = '00000000-0000-4000-8000-00000000f001';
select is(
  (select version from public.cart_places where id = '00000000-0000-4000-8000-00000000f001'),
  2,
  'update bumps version to 2'
);

update public.cart_places set version = 1 where id = '00000000-0000-4000-8000-00000000f001';
select is(
  (select version from public.cart_places where id = '00000000-0000-4000-8000-00000000f001'),
  3,
  'update cannot rewind version (client value ignored)'
);

-- ---------------------------------------------------------------------------
-- jsonb shape / size checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.program_weeks (kind, date, data)
    values ('midweek', '2026-10-20', jsonb_build_object('blob', (select string_agg(md5(i::text), '') from generate_series(1, 4000) i)))$$,
  '23514', null,
  'program_weeks.data larger than 64 KB is rejected'
);

select throws_ok(
  $$insert into public.program_weeks (kind, date, data) values ('midweek', '2026-10-20', '[]')$$,
  '23514', null,
  'program_weeks.data must be an object'
);

select throws_ok(
  $$insert into public.program_weeks (kind, date) values ('midweek', '2026-10-21')$$,
  '23514', null,
  'midweek program must be keyed by a Tuesday'
);

select throws_ok(
  $$insert into public.program_weeks (kind, date) values ('weekend', '2026-10-25')$$,
  '23514', null,
  'weekend program must be keyed by a Saturday'
);

select throws_ok(
  $$insert into public.territories (id, name, geometry, centroid_lng, centroid_lat)
    values (999, 'X', '{"type":"Point","coordinates":[0,0]}', 0, 0)$$,
  '23514', null,
  'territory geometry must be Polygon or MultiPolygon'
);

-- ---------------------------------------------------------------------------
-- Salidas: Domingo G1-G4 layout
-- ---------------------------------------------------------------------------
insert into public.service_weeks (id, week_start) values ('00000000-0000-4000-8000-00000000f101', '2026-11-02');

select lives_ok(
  $$insert into public.service_meetings (week_id, dow, kind, group_territories)
    values ('00000000-0000-4000-8000-00000000f101', 0, 'domingo', '{"G1":[1],"G2":[2],"G3":[3],"G4":[4]}')$$,
  'domingo meeting accepts a G1-G4 territory layout'
);

select throws_ok(
  $$insert into public.service_meetings (week_id, dow, kind, group_territories)
    values ('00000000-0000-4000-8000-00000000f101', 0, 'domingo', '{"G5":[1]}')$$,
  '23514', null,
  'group_territories only accepts keys G1..G4'
);

select throws_ok(
  $$insert into public.service_meetings (week_id, dow, kind, group_territories)
    values ('00000000-0000-4000-8000-00000000f101', 3, 'normal', '{"G1":[1]}')$$,
  '23514', null,
  'normal meetings cannot carry group_territories'
);

select throws_ok(
  $$insert into public.service_meetings (week_id, dow, kind) values ('00000000-0000-4000-8000-00000000f101', 3, 'domingo')$$,
  '23514', null,
  'domingo kind only on Sunday (dow 0)'
);

select throws_ok(
  $$insert into public.service_weeks (week_start) values ('2026-11-04')$$,
  '23514', null,
  'service_weeks.week_start must be a Monday'
);

-- ---------------------------------------------------------------------------
-- person_pairs symmetry
-- ---------------------------------------------------------------------------
insert into public.people (id, name, gender) values
  ('00000000-0000-4000-8000-00000000f201', 'Persona Test A', 'F'),
  ('00000000-0000-4000-8000-00000000f202', 'Persona Test B', 'M'),
  ('00000000-0000-4000-8000-00000000f203', 'Persona Test C', 'F');

insert into public.person_pairs (person_a, person_b)
values ('00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f201');

select results_eq(
  $$select person_a, person_b from public.person_pairs where person_b = '00000000-0000-4000-8000-00000000f202'$$,
  $$values ('00000000-0000-4000-8000-00000000f201'::uuid, '00000000-0000-4000-8000-00000000f202'::uuid)$$,
  'pair stored with person_a < person_b regardless of insert order'
);

select throws_ok(
  $$insert into public.person_pairs (person_a, person_b)
    values ('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f202')$$,
  '23505', null,
  'the same pair cannot be stored twice (either order)'
);

select throws_ok(
  $$insert into public.person_pairs (person_a, person_b)
    values ('00000000-0000-4000-8000-00000000f203', '00000000-0000-4000-8000-00000000f203')$$,
  '23514', null,
  'a person cannot be paired with themselves'
);

-- ---------------------------------------------------------------------------
-- cart_assignments: person_names snapshot
-- ---------------------------------------------------------------------------
insert into public.cart_slots (id, place_id, iso_dow, start_time, end_time)
values ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f001', 1, '09:00', '11:00');
insert into public.cart_schedules (id, start_date, end_date)
values ('00000000-0000-4000-8000-00000000f401', '2026-11-02', '2026-11-30');
insert into public.cart_assignments (id, schedule_id, slot_id, week_date, person_ids, person_names)
values ('00000000-0000-4000-8000-00000000f501', '00000000-0000-4000-8000-00000000f401',
        '00000000-0000-4000-8000-00000000f301', '2026-11-02',
        '{00000000-0000-4000-8000-00000000f202,00000000-0000-4000-8000-00000000f201}', '{spoofed,spoofed}');

select is(
  (select person_names from public.cart_assignments where id = '00000000-0000-4000-8000-00000000f501'),
  array['Persona Test B', 'Persona Test A'],
  'person_names derived from people in person_ids order (client value ignored)'
);

update public.people set name = 'Persona Test B2' where id = '00000000-0000-4000-8000-00000000f202';
select is(
  (select person_names from public.cart_assignments where id = '00000000-0000-4000-8000-00000000f501'),
  array['Persona Test B2', 'Persona Test A'],
  'renaming a person refreshes assignment names'
);

delete from public.people where id = '00000000-0000-4000-8000-00000000f201';
select is(
  (select person_ids from public.cart_assignments where id = '00000000-0000-4000-8000-00000000f501'),
  array['00000000-0000-4000-8000-00000000f202'::uuid],
  'deleting a person removes them from assignments'
);

select throws_ok(
  $$update public.cart_assignments set person_ids = '{00000000-0000-4000-8000-0000000fffff}'
     where id = '00000000-0000-4000-8000-00000000f501'$$,
  '23503', null,
  'unknown person ids are rejected'
);

select * from finish();
rollback;
