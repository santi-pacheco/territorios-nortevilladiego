-- Schedule entries linked to people by id (service_meetings.conductor_person_id, program
-- person_id), people_directory() and the widened create_person_from_name().
-- Fixtures use June 2027 dates and "Fixture" names so seed rows never match.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.login_as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function tests.login_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- Users: viewer (linked to Luis), programa, privilegios, editor.
insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'luis@test.local'),
  ('dddddddd-0000-4000-8000-000000000002', 'programa@test.local'),
  ('dddddddd-0000-4000-8000-000000000003', 'privilegios@test.local'),
  ('dddddddd-0000-4000-8000-000000000004', 'editor@test.local'),
  ('dddddddd-0000-4000-8000-000000000005', 'plain@test.local');
update public.profiles set can_edit_programa_midweek = true, can_edit_programa_weekend = true
 where id = 'dddddddd-0000-4000-8000-000000000002';
update public.profiles set can_edit_privilegios = true where id = 'dddddddd-0000-4000-8000-000000000003';
update public.profiles set role = 'editor' where id = 'dddddddd-0000-4000-8000-000000000004';

-- Luis (the member), Otro (shares Luis's spelling in linked entries) and Gone (deleted below).
insert into public.people (id, name, gender, aliases, duties, in_carrito) values
  ('cccccccc-0000-4000-8000-000000000001', 'Luis Fixture', 'M', '{"L. Fixture"}', '{sonido}', false),
  ('cccccccc-0000-4000-8000-000000000002', 'Otro Fixture', 'M', '{}', '{}', true),
  ('cccccccc-0000-4000-8000-000000000003', 'Gone Fixture', 'M', '{}', '{}', true);
update public.profiles set person_id = 'cccccccc-0000-4000-8000-000000000001'
 where id = 'dddddddd-0000-4000-8000-000000000001';

-- Midweek 2027-06-01 parts:
--   0 linked to Luis with a misspelt name         → Luis (by id)
--   1 legacy name by alias                          → Luis (by name)
--   2 Luis's spelling but linked to Otro            → not Luis
--   3 non-uuid person_id, Luis's name               → Luis (bad id ignored, falls back to name)
--   4 linked to Gone (deleted below), Luis's name   → Luis (dangling id = unlinked)
insert into public.program_weeks (kind, date, data) values
  ('midweek', '2027-06-01', '{"parts":[
     {"time":"19:05","title":"Lectura","people":[{"name":"Luiz Fixtur","person_id":"cccccccc-0000-4000-8000-000000000001"}]},
     {"time":"19:10","title":"Discurso","people":[{"name":"L. Fixture"}]},
     {"time":"19:20","title":"Perlas","people":[{"name":"Luis Fixture","person_id":"cccccccc-0000-4000-8000-000000000002"}]},
     {"time":"19:30","title":"Estudio","people":[{"name":"Luis Fixture","person_id":"not-a-uuid"}]},
     {"time":"19:40","title":"Necesidades","people":[{"name":"Luis Fixture","person_id":"cccccccc-0000-4000-8000-000000000003"}]}
   ]}'),
  -- Weekend 2027-06-05: lector linked (object), presidente legacy string, orador object linked
  -- to Otro with Luis's name, conductor object without id (name match), oración Otro (string).
  ('weekend', '2027-06-05', '{
     "presidente":"Luis Fixture",
     "lector":{"name":"Lector Mal Escrito","person_id":"cccccccc-0000-4000-8000-000000000001"},
     "conductor":{"name":"L. Fixture"},
     "oracionFinal":"Otro Fixture",
     "discurso":{"tipo":"PÚBLICO","titulo":"Tema","orador":{"name":"Luis Fixture","person_id":"cccccccc-0000-4000-8000-000000000002"}}
   }'),
  -- Weekend 2027-06-12: unlinked names for name_sources.
  ('weekend', '2027-06-12', '{"presidente":{"name":"Visita Fixture"},"lector":"Visita Fixture"}');

insert into public.service_weeks (id, week_start) values ('cccccccc-0000-4000-8000-000000000101', '2027-06-07');
insert into public.service_meetings (id, week_id, dow, kind, conductor, conductor_person_id) values
  -- linked, typed text is overwritten by the snapshot trigger
  ('cccccccc-0000-4000-8000-000000000201', 'cccccccc-0000-4000-8000-000000000101', 2, 'normal', 'cualquier cosa', 'cccccccc-0000-4000-8000-000000000001'),
  -- Luis's spelling but linked to Otro
  ('cccccccc-0000-4000-8000-000000000202', 'cccccccc-0000-4000-8000-000000000101', 3, 'normal', 'Luis Fixture', 'cccccccc-0000-4000-8000-000000000002'),
  -- legacy free text
  ('cccccccc-0000-4000-8000-000000000203', 'cccccccc-0000-4000-8000-000000000101', 4, 'normal', 'luis  FIXTURE', null);

delete from public.people where id = 'cccccccc-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Schema, snapshot trigger, helpers
-- ---------------------------------------------------------------------------
select has_column('public', 'service_meetings', 'conductor_person_id', 'service_meetings.conductor_person_id exists');
select fk_ok('public', 'service_meetings', 'conductor_person_id', 'public', 'people', 'id',
  'conductor_person_id references people(id)');
select has_index('public', 'service_meetings', 'service_meetings_conductor_person_id_idx',
  'conductor_person_id is indexed');
select is(
  (select conductor from public.service_meetings where id = 'cccccccc-0000-4000-8000-000000000201'),
  'Luis Fixture',
  'a linked conductor stores the people.name snapshot'
);
select is(
  (select conductor from public.service_meetings where id = 'cccccccc-0000-4000-8000-000000000203'),
  'luis  FIXTURE',
  'free-text conductor is kept as typed'
);
select throws_ok(
  $$insert into public.service_meetings (week_id, dow, kind, conductor_person_id)
    values ('cccccccc-0000-4000-8000-000000000101', 5, 'normal', 'cccccccc-0000-4000-8000-0000000009ff')$$,
  '23503', null, 'conductor_person_id must reference a person'
);
select results_eq(
  $$select private.program_person_name(v), private.program_person_id(v)
      from (values ('"Ana"'::jsonb), ('{"name":"Ana","person_id":"CCCCCCCC-0000-4000-8000-000000000001"}'),
                   ('{"name":"Ana","person_id":"bad"}'), ('3'), ('null')) x (v)$$,
  $$values ('Ana'::text, null::text), ('Ana', 'cccccccc-0000-4000-8000-000000000001'),
           ('Ana', null), (null, null), (null, null)$$,
  'program person helpers read both shapes and ignore malformed ids'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.people_directory()', 'execute')
  and not has_function_privilege('anon', 'public.create_person_from_name(text, text, boolean, text[])', 'execute')
  and has_function_privilege('authenticated', 'public.people_directory()', 'execute'),
  'anon cannot call people_directory / create_person_from_name'
);
select ok(
  not has_function_privilege('authenticated', 'private.live_person_id(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.program_person_id(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'private.can_edit_programa()', 'execute'),
  'new private helpers are not executable by clients; the RLS helpers still are'
);
select is(
  (select count(*)::int from pg_proc where proname = 'create_person_from_name'),
  1,
  'create_person_from_name has a single overload (PostgREST can resolve it)'
);

-- ---------------------------------------------------------------------------
-- my_assignments: by id when linked, else by name/alias
-- ---------------------------------------------------------------------------
select tests.login_as('dddddddd-0000-4000-8000-000000000001');
select results_eq(
  $$select key from public.my_assignments('2027-06-01', '2027-06-14') order by key$$,
  $$values
    ('programa:midweek:2027-06-01:0'::text),
    ('programa:midweek:2027-06-01:1'),
    ('programa:midweek:2027-06-01:3'),
    ('programa:midweek:2027-06-01:4'),
    ('programa:weekend:2027-06-05:conductor'),
    ('programa:weekend:2027-06-05:lector'),
    ('programa:weekend:2027-06-05:presidente'),
    ('salida:cccccccc-0000-4000-8000-000000000201'),
    ('salida:cccccccc-0000-4000-8000-000000000203')$$,
  'my_assignments: linked entries by id, legacy by name/alias; entries linked to someone else are excluded'
);
select is(
  (select role from public.my_assignments('2027-06-05', '2027-06-05') where key like '%:lector'),
  'Lector',
  'a linked weekend lector keeps its role'
);
reset role;

-- A rename keeps the link (and refreshes the salida snapshot); the misspelt linked entries stay.
update public.people set name = 'Luis Renombrado Fixture', aliases = '{}'
 where id = 'cccccccc-0000-4000-8000-000000000001';
select is(
  (select conductor from public.service_meetings where id = 'cccccccc-0000-4000-8000-000000000201'),
  'Luis Renombrado Fixture',
  'a person rename refreshes the salida conductor snapshot'
);
select tests.login_as('dddddddd-0000-4000-8000-000000000001');
select results_eq(
  $$select key from public.my_assignments('2027-06-01', '2027-06-14') order by key$$,
  $$values
    ('programa:midweek:2027-06-01:0'::text),
    ('programa:weekend:2027-06-05:lector'),
    ('salida:cccccccc-0000-4000-8000-000000000201')$$,
  'after a rename only the linked entries remain (match by link, not spelling)'
);
reset role;
update public.people set name = 'Luis Fixture', aliases = '{"L. Fixture"}'
 where id = 'cccccccc-0000-4000-8000-000000000001';

-- Reminders read the same feed.
select is(
  (select count(*)::int from private.assignments_for_person(
     'cccccccc-0000-4000-8000-000000000002', '2027-06-01', '2027-06-14')),
  4,
  'Otro gets the entries linked to them (midweek part, orador, salida) plus the oración by name'
);

-- ---------------------------------------------------------------------------
-- name_sources: linked entries are not listed
-- ---------------------------------------------------------------------------
select tests.login_as('dddddddd-0000-4000-8000-000000000004');
select ok(
  not exists (select 1 from public.name_sources() where name in ('Luiz Fixtur', 'Lector Mal Escrito', 'cualquier cosa')),
  'name_sources does not list linked entries'
);
select ok(
  not exists (select 1 from public.name_sources() where name like '{%'),
  'name_sources never lists raw JSON as a name'
);
select results_eq(
  $$select name, uses, person_id from public.name_sources() where norm = 'visita fixture'$$,
  $$values ('Visita Fixture'::text, 2, null::uuid)$$,
  'name_sources reads object-shaped weekend fields without an id'
);
select results_eq(
  $$select uses, sources, person_id from public.name_sources() where norm = 'luis fixture'$$,
  $$values (4, '{programa,salida}'::text[], 'cccccccc-0000-4000-8000-000000000001'::uuid)$$,
  'unlinked spellings (bad id, dangling id, presidente, free-text salida) still group and match'
);

-- ---------------------------------------------------------------------------
-- people_directory
-- ---------------------------------------------------------------------------
select results_eq(
  $$select name, aliases, duties, in_carrito from public.people_directory() where name like '%Fixture' order by name$$,
  $$values ('Luis Fixture'::text, '{"L. Fixture"}'::text[], '{sonido}'::text[], false),
           ('Otro Fixture', '{}', '{}', true)$$,
  'editor: people_directory lists everyone with aliases, duties and in_carrito'
);
reset role;
select tests.login_as('dddddddd-0000-4000-8000-000000000002');
select ok((select count(*) from public.people_directory() where name like '%Fixture') = 2,
  'either program grant: people_directory allowed');
reset role;
select tests.login_as('dddddddd-0000-4000-8000-000000000003');
select ok((select count(*) from public.people_directory() where name like '%Fixture') = 2,
  'can_edit_privilegios: people_directory allowed');
reset role;
select tests.login_as('dddddddd-0000-4000-8000-000000000005');
select throws_ok($$select * from public.people_directory()$$, '42501', null,
  'plain viewer cannot call people_directory');
select throws_ok($$select public.create_person_from_name('Nadie Fixture', 'M')$$, '42501', null,
  'plain viewer cannot create people');
reset role;
select tests.login_anon();
select throws_ok($$select * from public.people_directory()$$, '42501', null,
  'anon cannot call people_directory');
reset role;

-- ---------------------------------------------------------------------------
-- create_person_from_name from the pickers
-- ---------------------------------------------------------------------------
select tests.login_as('dddddddd-0000-4000-8000-000000000002');
select lives_ok(
  $$select public.create_person_from_name('Nuevo Programa Fixture', 'F', true, '{sonido}')$$,
  'either program grant can create a person from the picker'
);
select throws_ok(
  $$select public.create_person_from_name('l. fixture', 'M')$$, '23505', null,
  'creating a duplicate (name or alias) raises 23505'
);
reset role;
select tests.login_as('dddddddd-0000-4000-8000-000000000003');
select lives_ok(
  $$select public.create_person_from_name('Nuevo Privilegios Fixture', 'M', true, '{acomodador}')$$,
  'can_edit_privilegios can create a person from the picker'
);
reset role;
select results_eq(
  $$select name, in_carrito, duties from public.people where name like 'Nuevo % Fixture' order by name$$,
  $$values ('Nuevo Privilegios Fixture'::text, false, '{acomodador}'::text[]),
           ('Nuevo Programa Fixture', false, '{}')$$,
  'non-editors cannot add people to the carrito; only privilegios editors tag duties'
);
select tests.login_as('dddddddd-0000-4000-8000-000000000004');
select public.create_person_from_name('Nuevo Editor Fixture', 'M', true);
select is(
  (select in_carrito from public.people where name = 'Nuevo Editor Fixture'),
  true,
  'editors still choose in_carrito'
);
reset role;

select * from finish();
rollback;
