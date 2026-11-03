-- Only the administrator creates and deletes people (migration 20261103120000).
-- RLS-denied INSERT raises 42501; a missing DELETE grant raises 42501 too. Fixtures use their
-- own UUID prefix and 2028 dates.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

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
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, email) values
  ('a8a8a8a8-0000-4000-8000-000000000001', 'admin@adminonly.local'),
  ('a8a8a8a8-0000-4000-8000-000000000002', 'editor@adminonly.local'),
  ('a8a8a8a8-0000-4000-8000-000000000003', 'programa@adminonly.local'),
  ('a8a8a8a8-0000-4000-8000-000000000004', 'privilegios@adminonly.local');
update public.profiles set role = 'admin'  where id = 'a8a8a8a8-0000-4000-8000-000000000001';
update public.profiles set role = 'editor' where id = 'a8a8a8a8-0000-4000-8000-000000000002';
update public.profiles
   set can_edit_programa_midweek = true, can_edit_programa_weekend = true
 where id = 'a8a8a8a8-0000-4000-8000-000000000003';
update public.profiles set can_edit_privilegios = true where id = 'a8a8a8a8-0000-4000-8000-000000000004';

-- Free: nothing points at it. Busy: one reference of each kind is added per test below.
insert into public.people (id, name, gender) values
  ('a8a8a8a8-0000-4000-8000-000000000101', 'Libre Admin', 'M'),
  ('a8a8a8a8-0000-4000-8000-000000000102', 'Usada Programa', 'F'),
  ('a8a8a8a8-0000-4000-8000-000000000103', 'Usada Privilegios', 'F'),
  ('a8a8a8a8-0000-4000-8000-000000000104', 'Usada Carrito', 'M'),
  ('a8a8a8a8-0000-4000-8000-000000000105', 'Con Cuenta', 'M');

insert into public.cart_places (id, name) values ('a8a8a8a8-0000-4000-8000-000000000201', 'Plaza AdminOnly');
insert into public.cart_slots (id, place_id, iso_dow, start_time, end_time) values
  ('a8a8a8a8-0000-4000-8000-000000000301', 'a8a8a8a8-0000-4000-8000-000000000201', 2, '09:00', '11:00');
insert into public.person_availability (person_id, slot_id) values
  ('a8a8a8a8-0000-4000-8000-000000000101', 'a8a8a8a8-0000-4000-8000-000000000301');

insert into public.program_weeks (kind, date, data) values
  ('midweek', '2028-02-01',
   '{"parts":[{"time":"19:05","title":"Lectura","people":[{"name":"Usada Programa","person_id":"a8a8a8a8-0000-4000-8000-000000000102"}]}]}');
insert into public.duty_roster (date, role, slot, person_id, person_name) values
  ('2028-02-01', 'sonido', 1, 'a8a8a8a8-0000-4000-8000-000000000103', 'Usada Privilegios');
insert into public.cart_schedules (id, name, start_date, end_date) values
  ('a8a8a8a8-0000-4000-8000-000000000401', 'Plan AdminOnly', '2028-02-01', '2028-02-28');
insert into public.cart_assignments (schedule_id, slot_id, week_date, person_ids) values
  ('a8a8a8a8-0000-4000-8000-000000000401', 'a8a8a8a8-0000-4000-8000-000000000301', '2028-01-31',
   '{a8a8a8a8-0000-4000-8000-000000000104}');
update public.profiles set person_id = 'a8a8a8a8-0000-4000-8000-000000000105'
 where id = 'a8a8a8a8-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Grants: nobody deletes people straight from the client
-- ---------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.people', 'delete'),
  'authenticated has no DELETE on people'
);
select ok(
  not has_function_privilege('anon', 'public.delete_person(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_person(uuid)', 'execute'),
  'delete_person: anon cannot execute, authenticated can (checks admin inside)'
);

-- ---------------------------------------------------------------------------
-- Non-admins: no INSERT, no create RPC, no delete RPC
-- ---------------------------------------------------------------------------
select tests.login_as('a8a8a8a8-0000-4000-8000-000000000002');
select throws_ok($$insert into public.people (name, gender) values ('Editor Nuevo', 'M')$$,
  '42501', null, 'editor cannot insert people');
select throws_ok($$select public.create_person_from_name('Editor Nuevo', 'M')$$,
  '42501', null, 'editor cannot create_person_from_name');
select throws_ok($$delete from public.people where id = 'a8a8a8a8-0000-4000-8000-000000000101'$$,
  '42501', null, 'editor cannot delete people directly');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000101')$$,
  '42501', null, 'editor cannot delete_person');
reset role;

select tests.login_as('a8a8a8a8-0000-4000-8000-000000000003');
select throws_ok($$select public.create_person_from_name('Programa Nuevo', 'F')$$,
  '42501', null, 'a program grant cannot create people');
reset role;

select tests.login_as('a8a8a8a8-0000-4000-8000-000000000004');
select throws_ok($$select public.create_person_from_name('Privilegios Nuevo', 'F')$$,
  '42501', null, 'can_edit_privilegios cannot create people');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000101')$$,
  '42501', null, 'can_edit_privilegios cannot delete_person');
reset role;

-- ---------------------------------------------------------------------------
-- Admin: creates, and deletes only what nothing references
-- ---------------------------------------------------------------------------
select tests.login_as('a8a8a8a8-0000-4000-8000-000000000001');
select lives_ok($$insert into public.people (name, gender) values ('Admin Directo', 'M')$$,
  'admin can insert people');
select lives_ok($$select public.create_person_from_name('Admin Rpc', 'F', true, '{sonido}')$$,
  'admin can create_person_from_name');

select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000102')$$,
  '23503', null, 'a person in the program cannot be deleted');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000103')$$,
  '23503', null, 'a person in privilegios cannot be deleted');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000104')$$,
  '23503', null, 'a person in a carrito assignment cannot be deleted');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000105')$$,
  '23503', null, 'a person with a linked account cannot be deleted');
select throws_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-0000000009ff')$$,
  'P0002', null, 'an unknown person is reported');

select lives_ok($$select public.delete_person('a8a8a8a8-0000-4000-8000-000000000101')$$,
  'admin deletes an unreferenced person');
reset role;

select is(
  (select count(*)::int from public.people where id = 'a8a8a8a8-0000-4000-8000-000000000101')
  + (select count(*)::int from public.person_availability where person_id = 'a8a8a8a8-0000-4000-8000-000000000101'),
  0,
  'the person and their availability are gone'
);
select is(
  (select count(*)::int from public.people where id between 'a8a8a8a8-0000-4000-8000-000000000102'
                                                        and 'a8a8a8a8-0000-4000-8000-000000000105'),
  4,
  'the blocked deletes left the referenced people in place'
);

select * from finish();
rollback;
