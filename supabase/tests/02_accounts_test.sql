-- Member accounts, name matching, the assignment feed and the account RPCs
-- (docs/ASSIGNMENTS.md). Fixtures use 2027 dates so they never mix with seed.sql.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

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

-- Users: the trigger creates their profiles.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('cccccccc-0000-4000-8000-000000000001', 'member@test.local',
   '{"full_name":"Miembro Prueba","avatar_url":"https://example.test/a.png"}', '{"provider":"google"}'),
  ('cccccccc-0000-4000-8000-000000000002', 'other@test.local', '{}', '{"provider":"google"}'),
  ('cccccccc-0000-4000-8000-000000000003', 'editor@test.local', '{}', '{"provider":"email"}'),
  ('cccccccc-0000-4000-8000-000000000004', 'admin@test.local', '{}', '{"provider":"email"}'),
  ('cccccccc-0000-4000-8000-000000000005', 'long@test.local',
   jsonb_build_object('full_name', repeat('x', 200)), '{}');

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------
select results_eq(
  $$select role, display_name from public.profiles where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  $$values ('viewer'::text, 'Miembro Prueba'::text)$$,
  'new auth user gets a viewer profile with display_name = full_name'
);
select is(
  (select display_name from public.profiles where id = 'cccccccc-0000-4000-8000-000000000002'),
  null,
  'no full_name → display_name null'
);
select is(
  (select char_length(display_name) from public.profiles where id = 'cccccccc-0000-4000-8000-000000000005'),
  80,
  'an over-long full_name is truncated instead of failing sign-up'
);

update public.profiles set role = 'editor' where id = 'cccccccc-0000-4000-8000-000000000003';
update public.profiles set role = 'admin'  where id = 'cccccccc-0000-4000-8000-000000000004';
-- Keep the seeded/other admins out of the "last admin" checks below.
update public.profiles set role = 'viewer'
 where role = 'admin' and id <> 'cccccccc-0000-4000-8000-000000000004';

-- People. Fixture names are fake.
insert into public.people (id, name, gender, aliases) values
  ('dddddddd-0000-4000-8000-000000000001', 'Lucía  Fixture', 'F', '{"L. Fixture"}'),
  ('dddddddd-0000-4000-8000-000000000002', 'Mateo Fixture',  'M', '{}');

-- Carrito: Monday 2027-03-01, Tuesday slot (iso_dow 2) → 2027-03-02. One blacked-out week.
insert into public.cart_places (id, name) values ('dddddddd-0000-4000-8000-000000000101', 'Plaza Fixture');
insert into public.cart_slots (id, place_id, iso_dow, start_time, end_time)
values ('dddddddd-0000-4000-8000-000000000201', 'dddddddd-0000-4000-8000-000000000101', 2, '09:00', '11:00');
insert into public.cart_schedules (id, start_date, end_date)
values ('dddddddd-0000-4000-8000-000000000301', '2027-03-01', '2027-03-14');
insert into public.cart_assignments (id, schedule_id, slot_id, week_date, person_ids, note) values
  ('dddddddd-0000-4000-8000-000000000401', 'dddddddd-0000-4000-8000-000000000301',
   'dddddddd-0000-4000-8000-000000000201', '2027-03-01',
   '{dddddddd-0000-4000-8000-000000000002,dddddddd-0000-4000-8000-000000000001}', 'Llevar folletos'),
  ('dddddddd-0000-4000-8000-000000000402', 'dddddddd-0000-4000-8000-000000000301',
   'dddddddd-0000-4000-8000-000000000201', '2027-03-08',
   '{dddddddd-0000-4000-8000-000000000001}', null);
insert into public.cart_blackouts (slot_id, date) values ('dddddddd-0000-4000-8000-000000000201', '2027-03-09');

-- Programa: midweek Tuesday 2027-03-02 (accent-less spelling), weekend Saturday 2027-03-06 (alias).
insert into public.program_weeks (kind, date, data) values
  ('midweek', '2027-03-02', '{"date":"2027-03-02","asamblea":null,"parts":[
     {"time":"19:00","title":"Canción y oración","section":"inicio","people":[{"name":"Mateo Fixture","role":"Presidente"}]},
     {"time":"19:30","title":"Lectura de la Biblia","section":"tesoros","people":[{"name":" lucia   FIXTURE ","role":"Lector"}]}]}'),
  ('weekend', '2027-03-06', '{"date":"2027-03-06","asamblea":null,"presidente":"Mateo Fixture","cancionInicio":"1",
     "conductor":"Otro Nombre","lector":"L. Fixture","cancionFin":"2","oracionFinal":null,
     "discurso":{"tipo":"PÚBLICO","titulo":"Discurso fixture","orador":"Lucia Fixture","congregacion":null,"saliente":null}}');

-- Salidas: week of Monday 2027-03-01, Sunday meeting (dow 0 → 2027-03-07).
insert into public.service_weeks (id, week_start) values ('dddddddd-0000-4000-8000-000000000501', '2027-03-01');
insert into public.service_meetings (id, week_id, dow, kind, start_time, groups, conductor, place) values
  ('dddddddd-0000-4000-8000-000000000601', 'dddddddd-0000-4000-8000-000000000501', 0, 'domingo', '09:45', 'G1-G4', 'LUCÍA FIXTURE', 'Salón Fixture'),
  ('dddddddd-0000-4000-8000-000000000602', 'dddddddd-0000-4000-8000-000000000501', 3, 'normal', '09:30', '1', 'Mateo Fixture', 'Esquina Fixture');

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------
select is(private.norm_name('  Lucía   FIXTURE '), 'lucia fixture', 'norm_name: unaccent + lower + trim + collapse spaces');
select is(private.norm_name(null), '', 'norm_name(null) is empty');
select is(
  private.person_match_names('dddddddd-0000-4000-8000-000000000001'),
  array['l. fixture', 'lucia fixture'],
  'match names = normalised name + aliases'
);

-- ---------------------------------------------------------------------------
-- Each kind
-- ---------------------------------------------------------------------------
select results_eq(
  $$select key, date, start_time, title, place, role, detail
      from private.assignments_for_person('dddddddd-0000-4000-8000-000000000001', '2027-03-01', '2027-03-14')
     where kind = 'carrito'$$,
  $$values ('carrito:dddddddd-0000-4000-8000-000000000401:2027-03-02', '2027-03-02'::date, '09:00',
            'Plaza Fixture', 'Plaza Fixture', null::text, 'Mateo Fixture · Llevar folletos')$$,
  'carrito: date = week_date + iso_dow - 1, others + note in detail, blacked-out date skipped'
);

select results_eq(
  $$select key, date, start_time, title, role
      from private.assignments_for_person('dddddddd-0000-4000-8000-000000000001', '2027-03-01', '2027-03-14')
     where key like 'programa:midweek:%'$$,
  $$values ('programa:midweek:2027-03-02:1', '2027-03-02'::date, '19:30', 'Lectura de la Biblia', 'Lector')$$,
  'programa midweek: matched despite accents/case/spaces, role from the part'
);

select results_eq(
  $$select key, title, role
      from private.assignments_for_person('dddddddd-0000-4000-8000-000000000001', '2027-03-01', '2027-03-14')
     where key like 'programa:weekend:%' order by key$$,
  $$values ('programa:weekend:2027-03-06:lector', 'Estudio de La Atalaya', 'Lector'),
           ('programa:weekend:2027-03-06:orador', 'Discurso fixture', 'Orador')$$,
  'programa weekend: lector via alias, orador via name, title = discurso.titulo'
);

select results_eq(
  $$select key, date, start_time, title, place, role, detail
      from private.assignments_for_person('dddddddd-0000-4000-8000-000000000001', '2027-03-01', '2027-03-14')
     where kind = 'salida'$$,
  $$values ('salida:dddddddd-0000-4000-8000-000000000601', '2027-03-07'::date, '09:45',
            'Salón Fixture', 'Salón Fixture', 'Conductor', 'G1-G4')$$,
  'salida: conductor matched, Sunday (dow 0) = week_start + 6'
);

select is(
  (select count(*)::int
     from private.assignments_for_person('dddddddd-0000-4000-8000-000000000002', '2027-03-01', '2027-03-14')),
  4,
  'other person: carrito + midweek presidente + weekend presidente + salida (no cross-matching)'
);

select is(
  (select count(*)::int
     from private.assignments_for_person('dddddddd-0000-4000-8000-000000000001', '2027-03-03', '2027-03-05')),
  0,
  'date range is respected'
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.my_assignments(date, date)', 'execute')
  and not has_function_privilege('anon', 'public.my_link()', 'execute')
  and not has_function_privilege('anon', 'public.list_accounts()', 'execute')
  and not has_function_privilege('anon', 'public.link_account(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_account_role(uuid, text)', 'execute'),
  'anon cannot execute any account RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.reminder_candidates(date, date)', 'execute')
  and not has_function_privilege('anon', 'public.reminder_candidates(date, date)', 'execute'),
  'reminder_candidates is server-only'
);
select ok(
  not has_table_privilege('authenticated', 'public.reminder_log', 'select')
  and not has_table_privilege('authenticated', 'public.reminder_log', 'insert')
  and not has_table_privilege('anon', 'public.reminder_log', 'select'),
  'reminder_log has no client access'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'person_id', 'update'),
  'clients cannot write profiles.person_id'
);
select ok(
  has_column_privilege('authenticated', 'public.people', 'aliases', 'update'),
  'people.aliases is writable like the rest of people (RLS: editors)'
);

-- ---------------------------------------------------------------------------
-- Viewer (member) RPCs
-- ---------------------------------------------------------------------------
select tests.login_as('cccccccc-0000-4000-8000-000000000001');

select is((select count(*)::int from public.my_assignments('2027-03-01', '2027-03-14')), 0,
  'unlinked member: my_assignments is empty');
select is((select count(*)::int from public.my_link()), 0, 'unlinked member: my_link is empty');
select throws_ok($$select public.list_accounts()$$, '42501', null, 'viewer cannot list accounts');
select throws_ok(
  $$select public.link_account('cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001')$$,
  '42501', null, 'viewer cannot link (not even themselves)');
select throws_ok(
  $$select public.set_account_role('cccccccc-0000-4000-8000-000000000001', 'admin')$$,
  '42501', null, 'viewer cannot set roles');
select throws_ok(
  $$update public.profiles set person_id = 'dddddddd-0000-4000-8000-000000000001' where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  '42501', null, 'viewer cannot write person_id directly');
select throws_ok($$select * from public.reminder_log$$, '42501', null, 'viewer cannot read reminder_log');

-- ---------------------------------------------------------------------------
-- Editor RPCs
-- ---------------------------------------------------------------------------
select tests.login_as('cccccccc-0000-4000-8000-000000000003');

select lives_ok(
  $$select public.link_account('cccccccc-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001')$$,
  'editor links the member to a person');
select throws_ok(
  $$select public.link_account('cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001')$$,
  '23505', null, 'a person can be linked to only one account');
select results_eq(
  $$select email, display_name, avatar_url, provider, role, person_id, person_name
      from public.list_accounts() where user_id = 'cccccccc-0000-4000-8000-000000000001'$$,
  $$values ('member@test.local'::text, 'Miembro Prueba'::text, 'https://example.test/a.png'::text, 'google'::text,
            'viewer'::text, 'dddddddd-0000-4000-8000-000000000001'::uuid, 'Lucía  Fixture'::text)$$,
  'editor lists accounts with role, provider and linked person');
select throws_ok(
  $$select public.set_account_role('cccccccc-0000-4000-8000-000000000001', 'editor')$$,
  '42501', null, 'editor (non-admin) cannot set roles');

-- ---------------------------------------------------------------------------
-- Linked member sees only their own
-- ---------------------------------------------------------------------------
select tests.login_as('cccccccc-0000-4000-8000-000000000001');

select results_eq(
  $$select person_id, person_name from public.my_link()$$,
  $$values ('dddddddd-0000-4000-8000-000000000001'::uuid, 'Lucía  Fixture'::text)$$,
  'linked member: my_link names the person');
select results_eq(
  $$select kind, date from public.my_assignments('2027-03-01', '2027-03-14')$$,
  $$values ('carrito'::text, '2027-03-02'::date), ('programa', '2027-03-02'),
           ('programa', '2027-03-06'), ('programa', '2027-03-06'), ('salida', '2027-03-07')$$,
  'linked member: my_assignments returns exactly their assignments, ordered by date');
select throws_ok($$select * from public.my_assignments('2027-03-14', '2027-03-01')$$, '22023', null,
  'my_assignments rejects an inverted range');

select tests.login_as('cccccccc-0000-4000-8000-000000000002');
select is((select count(*)::int from public.my_assignments('2027-03-01', '2027-03-14')), 0,
  'another member does not see the linked member''s assignments');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
select tests.login_as('cccccccc-0000-4000-8000-000000000004');

select lives_ok($$select public.set_account_role('cccccccc-0000-4000-8000-000000000003', 'admin')$$,
  'admin promotes an editor to admin');
select lives_ok($$select public.set_account_role('cccccccc-0000-4000-8000-000000000003', 'editor')$$,
  'admin demotes another admin while one admin remains');
select throws_ok($$select public.set_account_role('cccccccc-0000-4000-8000-000000000004', 'viewer')$$,
  '42501', null, 'the last admin cannot be demoted');
select throws_ok($$select public.set_account_role('cccccccc-0000-4000-8000-000000000002', 'owner')$$,
  '22023', null, 'invalid role rejected');

select tests.login_as('cccccccc-0000-4000-8000-000000000003');
select lives_ok($$select public.link_account('cccccccc-0000-4000-8000-000000000001', null)$$,
  'editor unlinks with null');

reset role;
select is(
  (select person_id from public.profiles where id = 'cccccccc-0000-4000-8000-000000000001'),
  null,
  'unlink cleared person_id'
);

select * from finish();
rollback;
