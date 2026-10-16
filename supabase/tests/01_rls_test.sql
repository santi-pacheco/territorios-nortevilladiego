-- RLS / grants by persona: anon, viewer, authenticated-without-profile, editor, admin.
--
-- RLS-denied UPDATE/DELETE are silent (0 rows), so they are asserted with
-- tests.affected(), which returns the row count of the statement it runs.
-- Grant-level denials and RLS-denied INSERTs raise 42501.
begin;
create extension if not exists pgtap with schema extensions;

select plan(58);

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
grant execute on function tests.affected(text) to anon, authenticated;

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

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'viewer@test.local'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'editor@test.local'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'admin@test.local'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'noprofile@test.local');

insert into public.profiles (id, role) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'viewer'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'editor'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'admin');

insert into public.territories (id, name, geometry, centroid_lng, centroid_lat)
values (900, 'Fixture', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 0.5, 0.5);
insert into public.people (id, name, gender)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'Persona Fixture', 'F');
insert into public.device_tokens (user_id, token, platform)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'editor-device-token-xyz', 'android');

-- ---------------------------------------------------------------------------
-- Catalog-level grants
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT'),
  0,
  'anon holds no write/truncate privilege on any public table'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  0,
  'authenticated holds no TRUNCATE/REFERENCES/TRIGGER on public tables'
);

select ok(
  not has_table_privilege('anon', 'public.people', 'select')
  and not has_table_privilege('anon', 'public.person_availability', 'select')
  and not has_table_privilege('anon', 'public.person_pairs', 'select')
  and not has_table_privilege('anon', 'public.profiles', 'select')
  and not has_table_privilege('anon', 'public.device_tokens', 'select'),
  'anon has no SELECT on people, availability, pairs, profiles, device_tokens'
);

select ok(
  not has_function_privilege('anon', 'public.is_editor()', 'execute'),
  'anon cannot execute is_editor()'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'update')
  and not has_table_privilege('authenticated', 'public.profiles', 'insert'),
  'authenticated cannot insert profiles or update profiles.role'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
select tests.login_anon();
select is(current_user::text, 'anon', 'persona switch: running as anon');

select ok((select count(*) from public.territories) > 0, 'anon can read territories');
select lives_ok($$select * from public.service_meetings$$, 'anon can read service_meetings');
select lives_ok($$select * from public.cart_assignments$$, 'anon can read cart_assignments');
select lives_ok($$select * from public.program_weeks$$, 'anon can read program_weeks');

select throws_ok($$select * from public.people$$, '42501', null, 'anon cannot read people');
select throws_ok($$select * from public.person_availability$$, '42501', null, 'anon cannot read person_availability');
select throws_ok($$select * from public.person_pairs$$, '42501', null, 'anon cannot read person_pairs');
select throws_ok($$select * from public.device_tokens$$, '42501', null, 'anon cannot read device_tokens');

select throws_ok(
  $$insert into public.territories (id, name, geometry, centroid_lng, centroid_lat)
    values (901, 'X', '{"type":"Polygon","coordinates":[]}', 0, 0)$$,
  '42501', null, 'anon cannot insert territories');
select throws_ok($$update public.territories set name = 'hacked' where id = 900$$,
  '42501', null, 'anon cannot update territories');
select throws_ok($$delete from public.territories where id = 900$$,
  '42501', null, 'anon cannot delete territories');
select throws_ok($$insert into public.service_weeks (week_start) values ('2026-11-09')$$,
  '42501', null, 'anon cannot insert service_weeks');
select throws_ok($$insert into public.people (name, gender) values ('X', 'M')$$,
  '42501', null, 'anon cannot insert people');
select throws_ok($$insert into public.program_weeks (kind, date) values ('midweek', '2026-11-10')$$,
  '42501', null, 'anon cannot insert program_weeks');

reset role;

-- ---------------------------------------------------------------------------
-- viewer
-- ---------------------------------------------------------------------------
select tests.login_as('aaaaaaaa-0000-4000-8000-000000000001');
select is(current_user::text, 'authenticated', 'persona switch: running as authenticated');
select is(auth.uid(), 'aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'persona switch: running as viewer');

select ok(not public.is_editor(), 'viewer: is_editor() is false');
select ok((select count(*) from public.territories) > 0, 'viewer can read territories');
select is((select count(*)::int from public.people), 0, 'viewer sees no people');
select is((select count(*)::int from public.person_pairs), 0, 'viewer sees no person_pairs');
select is((select count(*)::int from public.device_tokens), 0, 'viewer cannot see another user''s device token');
select is((select count(*)::int from public.profiles), 1, 'viewer sees only their own profile');

select throws_ok(
  $$insert into public.territories (id, name, geometry, centroid_lng, centroid_lat)
    values (901, 'X', '{"type":"Polygon","coordinates":[]}', 0, 0)$$,
  '42501', null, 'viewer cannot insert territories');
select is(tests.affected($$update public.territories set name = 'hacked' where id = 900$$), 0,
  'viewer update of territories affects 0 rows');
select is(tests.affected($$delete from public.territories where id = 900$$), 0,
  'viewer delete of territories affects 0 rows');
select throws_ok($$insert into public.people (name, gender) values ('X', 'M')$$,
  '42501', null, 'viewer cannot insert people');
select is(tests.affected($$update public.people set name = 'hacked'$$), 0,
  'viewer update of people affects 0 rows');
select throws_ok($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501', null, 'viewer cannot promote themselves');
select is(tests.affected($$update public.profiles set display_name = 'Visor' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$), 1,
  'viewer can edit own display_name');
select is(tests.affected($$update public.device_tokens set token = 'stolen-token-0000' where token = 'editor-device-token-xyz'$$), 0,
  'viewer cannot update another user''s device token');
select is(tests.affected($$delete from public.device_tokens where token = 'editor-device-token-xyz'$$), 0,
  'viewer cannot delete another user''s device token');
select throws_ok(
  $$insert into public.device_tokens (user_id, token, platform)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'forged-token-for-editor', 'ios')$$,
  '42501', null, 'viewer cannot insert a device token for another user');
select lives_ok(
  $$insert into public.device_tokens (token, platform) values ('viewer-own-token-123', 'ios')$$,
  'viewer can register their own device token');

reset role;

select is(
  (select name from public.territories where id = 900), 'Fixture',
  'territory 900 unchanged after viewer attempts');
select is(
  (select role from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'viewer',
  'viewer role unchanged');

-- ---------------------------------------------------------------------------
-- authenticated user with no profile row behaves like a viewer
-- ---------------------------------------------------------------------------
select tests.login_as('aaaaaaaa-0000-4000-8000-000000000004');
select throws_ok($$insert into public.service_weeks (week_start) values ('2026-11-09')$$,
  '42501', null, 'user without profile cannot write');
select throws_ok($$insert into public.profiles (id, role) values ('aaaaaaaa-0000-4000-8000-000000000004', 'admin')$$,
  '42501', null, 'user without profile cannot create an admin profile for themselves');
reset role;

-- ---------------------------------------------------------------------------
-- editor
-- ---------------------------------------------------------------------------
select tests.login_as('aaaaaaaa-0000-4000-8000-000000000002');
select is(auth.uid(), 'aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'persona switch: running as editor');

select ok(public.is_editor(), 'editor: is_editor() is true');
select is((select count(*)::int from public.people where id = 'bbbbbbbb-0000-4000-8000-000000000001'), 1,
  'editor can read people');
select lives_ok(
  $$insert into public.territories (id, name, geometry, centroid_lng, centroid_lat)
    values (901, 'Nuevo', '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}', 0.5, 0.5)$$,
  'editor can insert territories');
select is(tests.affected($$update public.territories set name = 'Editado' where id = 900$$), 1,
  'editor can update territories');
select results_eq(
  $$select version, updated_by from public.territories where id = 900$$,
  $$values (2, 'aaaaaaaa-0000-4000-8000-000000000002'::uuid)$$,
  'update bumps version 1 -> 2 and records updated_by = editor');

-- CAS: a stale version matches nothing; the current one succeeds.
select is(tests.affected($$update public.territories set name = 'Stale' where id = 900 and version = 1$$), 0,
  'CAS with a stale version updates 0 rows');
select is(tests.affected($$update public.territories set name = 'Fresh' where id = 900 and version = 2$$), 1,
  'CAS with the current version updates 1 row');
select is((select version from public.territories where id = 900), 3, 'CAS success bumps version to 3');

select lives_ok($$insert into public.people (name, gender) values ('Persona Nueva', 'M')$$,
  'editor can insert people');
select is(tests.affected($$delete from public.territories where id = 901$$), 1,
  'editor can delete territories');
select throws_ok($$update public.profiles set role = 'admin' where id = 'aaaaaaaa-0000-4000-8000-000000000002'$$,
  '42501', null, 'editor cannot change their own role');
select is((select count(*)::int from public.device_tokens), 1, 'editor sees only their own device token');

reset role;

-- ---------------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------------
select tests.login_as('aaaaaaaa-0000-4000-8000-000000000003');
select ok(public.is_editor() and public.is_admin(), 'admin: is_editor() and is_admin() are true');
select lives_ok($$insert into public.cart_places (name) values ('Lugar Admin')$$, 'admin can write');
reset role;

select * from finish();
rollback;
