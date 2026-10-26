-- People directory, permissions, program editing grant and the Privilegios roster
-- (docs/PRIVILEGIOS.md). Fixtures use 2027 dates and "Fixture" names so seed rows never match.
--
-- RLS-denied UPDATE/DELETE are silent (0 rows): asserted with tests.affected().
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.affected(q text) returns integer
language plpgsql security invoker as $$
declare
  n integer;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;
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

-- Users: viewer (plain), tagged (linked to a person with duties), programa, privilegios, editor, admin.
insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'viewer@test.local'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'tagged@test.local'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'programa@test.local'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'privilegios@test.local'),
  ('eeeeeeee-0000-4000-8000-000000000005', 'editor@test.local'),
  ('eeeeeeee-0000-4000-8000-000000000006', 'admin@test.local');
update public.profiles set role = 'editor' where id = 'eeeeeeee-0000-4000-8000-000000000005';
update public.profiles set role = 'admin'  where id = 'eeeeeeee-0000-4000-8000-000000000006';

insert into public.people (id, name, gender, duties, aliases) values
  ('ffffffff-0000-4000-8000-000000000001', 'Tomás Fixture', 'M', '{sonido,microfonista}', '{"T. Fixture"}'),
  ('ffffffff-0000-4000-8000-000000000002', 'Pablo Fixture', 'M', '{}', '{}');
update public.profiles set person_id = 'ffffffff-0000-4000-8000-000000000001'
 where id = 'eeeeeeee-0000-4000-8000-000000000002';

-- Names in each source. 'Nuevo Fixture' is unmatched in the program (twice) and a salida;
-- 'T. Fixture' matches Tomás by alias; 'Libre Fixture' is a free-text roster cell.
insert into public.program_weeks (kind, date, data) values
  ('midweek', '2027-05-04', '{"parts":[{"time":"19:00","title":"Lectura","people":[{"name":"NUEVO  fixture"},{"name":"T. Fixture","role":"Ayudante"}]}]}'),
  ('weekend', '2027-05-08', '{"presidente":"Nuevo Fixture","discurso":{"orador":"Pablo Fixture"}}');
insert into public.service_weeks (id, week_start) values ('ffffffff-0000-4000-8000-000000000101', '2027-05-10');
insert into public.service_meetings (week_id, dow, kind, conductor) values
  ('ffffffff-0000-4000-8000-000000000101', 3, 'normal', 'Nuevo Fixture');
insert into public.duty_roster (id, date, role, slot, person_id, person_name, note) values
  ('ffffffff-0000-4000-8000-000000000201', '2027-05-04', 'sonido',       1, 'ffffffff-0000-4000-8000-000000000001', 'ignored', null),
  ('ffffffff-0000-4000-8000-000000000202', '2027-05-04', 'microfonista', 1, null, '  Libre   Fixture ', null),
  ('ffffffff-0000-4000-8000-000000000203', '2027-05-08', 'microfonista', 2, 'ffffffff-0000-4000-8000-000000000001', null, 'Pasillo'),
  ('ffffffff-0000-4000-8000-000000000204', '2027-05-15', 'sonido',       1, 'ffffffff-0000-4000-8000-000000000001', null, null);
insert into public.duty_days (date, kind) values ('2027-05-15', 'asamblea');

-- ---------------------------------------------------------------------------
-- Columns and derived data
-- ---------------------------------------------------------------------------
select ok(
  (select in_carrito from public.people where id = 'ffffffff-0000-4000-8000-000000000002'),
  'people.in_carrito defaults to true (existing carrito people unchanged)'
);
select throws_ok(
  $$update public.people set duties = '{lector}' where id = 'ffffffff-0000-4000-8000-000000000002'$$,
  '23514', null, 'people.duties only accepts the four privilegios'
);
select results_eq(
  $$select person_name from public.duty_roster where id in
      ('ffffffff-0000-4000-8000-000000000201', 'ffffffff-0000-4000-8000-000000000202') order by id$$,
  $$values ('Tomás Fixture'::text), ('Libre Fixture')$$,
  'duty_roster.person_name: people.name snapshot when matched, trimmed free text otherwise'
);
select throws_ok(
  $$insert into public.duty_roster (date, role, slot, person_name) values ('2027-05-04', 'sonido', 2, '   ')$$,
  '23514', null, 'a cell needs a person or a name'
);
select throws_ok(
  $$insert into public.duty_roster (date, role, slot, person_name) values ('2027-05-04', 'sonido', 5, 'X')$$,
  '23514', null, 'slot is 1..4'
);
select throws_ok(
  $$insert into public.duty_roster (date, role, slot, person_name) values ('2027-05-04', 'sonido', 1, 'X')$$,
  '23505', null, 'one row per (date, role, slot)'
);
update public.people set name = 'Tomás Fixture Renombrado' where id = 'ffffffff-0000-4000-8000-000000000001';
select is(
  (select person_name from public.duty_roster where id = 'ffffffff-0000-4000-8000-000000000201'),
  'Tomás Fixture Renombrado',
  'a person rename refreshes the roster snapshot'
);
update public.people set name = 'Tomás Fixture' where id = 'ffffffff-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.name_sources()', 'execute')
  and not has_function_privilege('anon', 'public.create_person_from_name(text, text, boolean, text[])', 'execute')
  and not has_function_privilege('anon', 'public.add_person_alias(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_account_permissions(uuid, boolean, boolean, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.my_permissions()', 'execute')
  and not has_function_privilege('anon', 'public.duty_people()', 'execute')
  and not has_function_privilege('anon', 'public.list_accounts()', 'execute'),
  'anon cannot execute any of the new RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'private.norm_name(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.assignments_for_person(uuid, date, date)', 'execute')
  and has_function_privilege('authenticated', 'private.sees_privilegios()', 'execute'),
  'authenticated executes only the RLS helpers in private'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'can_edit_programa_midweek', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'can_edit_programa_weekend', 'update')
  and not has_column_privilege('authenticated', 'public.profiles', 'can_edit_privilegios', 'update'),
  'clients cannot write the permission columns'
);

-- ---------------------------------------------------------------------------
-- Anon
-- ---------------------------------------------------------------------------
select tests.login_anon();
select throws_ok($$select * from public.duty_roster$$, '42501', null, 'anon cannot read duty_roster');
select throws_ok($$select * from public.duty_days$$, '42501', null, 'anon cannot read duty_days');

-- ---------------------------------------------------------------------------
-- Plain viewer
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000001');
select is((select count(*)::int from public.duty_roster), 0, 'plain viewer sees no roster rows');
select is((select count(*)::int from public.duty_days), 0, 'plain viewer sees no duty days');
select results_eq(
  $$select role, can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios, sees_privilegios
      from public.my_permissions()$$,
  $$values ('viewer'::text, false, false, false, false)$$,
  'plain viewer: my_permissions all false'
);
select throws_ok($$select * from public.name_sources()$$, '42501', null, 'viewer cannot call name_sources');
select throws_ok(
  $$select public.create_person_from_name('Otro Fixture', 'M')$$, '42501', null,
  'viewer cannot create people');
select throws_ok(
  $$select public.add_person_alias('ffffffff-0000-4000-8000-000000000002', 'P. Fixture')$$, '42501', null,
  'viewer cannot add aliases');
select throws_ok($$select * from public.duty_people()$$, '42501', null, 'viewer cannot list duty people');
select throws_ok(
  $$update public.profiles set can_edit_privilegios = true where id = 'eeeeeeee-0000-4000-8000-000000000001'$$,
  '42501', null, 'viewer cannot grant themselves a permission');

-- ---------------------------------------------------------------------------
-- Tagged linked viewer: read-only roster + privilegio assignments
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000002');
select ok((select sees_privilegios from public.my_permissions()), 'tagged member: sees_privilegios');
select ok(
  (select count(*) from public.duty_roster where date between '2027-05-01' and '2027-05-31') = 4
  and (select count(*) from public.duty_days where date = '2027-05-15') = 1,
  'tagged member reads the whole roster and the duty days'
);
select throws_ok(
  $$insert into public.duty_roster (date, role, slot, person_name) values ('2027-05-08', 'sonido', 1, 'X')$$,
  '42501', null, 'tagged member cannot insert');
select is(
  tests.affected($$update public.duty_roster set note = 'x' where id = 'ffffffff-0000-4000-8000-000000000201'$$),
  0, 'tagged member update affects 0 rows');
select is(
  tests.affected($$delete from public.duty_roster where id = 'ffffffff-0000-4000-8000-000000000201'$$),
  0, 'tagged member delete affects 0 rows');
select results_eq(
  $$select key, title, start_time, role, detail from public.my_assignments('2027-05-01', '2027-05-31')
     where kind = 'privilegio' order by key$$,
  $$values ('privilegio:2027-05-04:sonido:1'::text, 'Sonido'::text, null::text, null::text, null::text),
           ('privilegio:2027-05-08:microfonista:2', 'Micrófono', null, null, 'Pasillo')$$,
  'privilegio assignments by person_id; assembly day 05-15 skipped'
);
select throws_ok(
  $$insert into public.program_weeks (kind, date) values ('midweek', '2027-06-01')$$,
  '42501', null, 'tagged member cannot write the program');

-- ---------------------------------------------------------------------------
-- Editor: directory RPCs + roster write
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000005');
select results_eq(
  $$select name, sources, uses, first_date, last_date, person_id
      from public.name_sources() where norm like '%fixture%' order by norm$$,
  $$values ('Libre Fixture'::text, '{privilegio}'::text[], 1, '2027-05-04'::date, '2027-05-04'::date, null::uuid),
           ('Nuevo Fixture', '{programa,salida}', 3, '2027-05-04', '2027-05-12', null),
           ('Pablo Fixture', '{programa}', 1, '2027-05-08', '2027-05-08', 'ffffffff-0000-4000-8000-000000000002'::uuid),
           ('T. Fixture', '{programa}', 1, '2027-05-04', '2027-05-04', 'ffffffff-0000-4000-8000-000000000001'::uuid)$$,
  'name_sources: grouped by norm_name, sources/uses/dates, matched by name or alias'
);
select is(
  (select person_id from public.name_sources() limit 1), null,
  'name_sources lists unmatched names first'
);
select lives_ok(
  $$select public.create_person_from_name(' Nuevo   Fixture ', 'M')$$,
  'editor creates a person from a name');
select results_eq(
  $$select name, gender, in_carrito from public.people where name = 'Nuevo Fixture'$$,
  $$values ('Nuevo Fixture'::text, 'M'::text, false)$$,
  'created person: trimmed name, not in the carrito by default'
);
select throws_ok(
  $$select public.create_person_from_name('nuevo fixture', 'M')$$, '23505', null,
  'creating a duplicate (same norm_name) fails');
select throws_ok(
  $$select public.create_person_from_name('Otro Fixture', 'X')$$, '22023', null,
  'invalid gender rejected');
select lives_ok(
  $$select public.add_person_alias('ffffffff-0000-4000-8000-000000000002', 'Libre Fixture')$$,
  'editor adds an alias');
select lives_ok(
  $$select public.add_person_alias('ffffffff-0000-4000-8000-000000000002', 'LIBRE fixture')$$,
  'adding the same alias again is a no-op');
select throws_ok(
  $$select public.add_person_alias('ffffffff-0000-4000-8000-000000000002', 'T. Fixture')$$, '23505', null,
  'an alias that belongs to someone else is rejected');
select is(
  (select aliases from public.people where id = 'ffffffff-0000-4000-8000-000000000002'),
  array['Libre Fixture'],
  'alias stored once'
);
select is(
  tests.affected($$update public.duty_roster set note = 'Editor' where id = 'ffffffff-0000-4000-8000-000000000202'$$),
  1, 'editor writes the roster');
select throws_ok(
  $$select public.set_account_permissions('eeeeeeee-0000-4000-8000-000000000003', true, true, false)$$,
  '42501', null, 'editor (non-admin) cannot set permissions');

-- ---------------------------------------------------------------------------
-- Admin grants permissions
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000006');
select lives_ok(
  $$select public.set_account_permissions('eeeeeeee-0000-4000-8000-000000000003', true, true, false);
    select public.set_account_permissions('eeeeeeee-0000-4000-8000-000000000004', null, null, true)$$,
  'admin grants both program meetings and privilegios');
select results_eq(
  $$select user_id, can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios
      from public.list_accounts()
     where user_id in ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000004')
     order by user_id$$,
  $$values ('eeeeeeee-0000-4000-8000-000000000003'::uuid, true, true, false),
           ('eeeeeeee-0000-4000-8000-000000000004'::uuid, false, false, true)$$,
  'list_accounts shows the stored grants'
);

-- ---------------------------------------------------------------------------
-- Program-grant user writes program_weeks, not the roster
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000003');
select lives_ok(
  $$insert into public.program_weeks (kind, date, data) values ('midweek', '2027-06-01', '{}');
    update public.program_weeks set data = '{"parts":[]}' where kind = 'midweek' and date = '2027-06-01';
    delete from public.program_weeks where kind = 'midweek' and date = '2027-06-01'$$,
  'program grants: insert, update and delete program weeks');
select is((select count(*)::int from public.duty_roster), 0, 'program grants alone do not see the roster');

-- ---------------------------------------------------------------------------
-- can_edit_privilegios user writes the roster
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000004');
select lives_ok(
  $$insert into public.duty_roster (date, role, slot, person_id) values ('2027-05-08', 'sonido', 1, 'ffffffff-0000-4000-8000-000000000001');
    update public.duty_roster set note = 'Cambio' where id = 'ffffffff-0000-4000-8000-000000000203';
    insert into public.duty_days (date, kind) values ('2027-05-22', 'sin_reunion');
    delete from public.duty_roster where id = 'ffffffff-0000-4000-8000-000000000204'$$,
  'can_edit_privilegios: insert (person snapshot without reading people), update, delete, mark days');
select results_eq(
  $$select name, duties from public.duty_people() where name like '%Fixture'$$,
  $$values ('Tomás Fixture'::text, '{sonido,microfonista}'::text[])$$,
  'duty_people lists only people with duties'
);

select * from finish();
rollback;
