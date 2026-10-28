-- cart_blackouts.reason: optional, max 60 chars, same RLS as the table (public read, editor write).
-- Fixtures use their own UUID prefix and 2028 dates.
begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

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
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, email) values
  ('bcbcbcbc-0000-4000-8000-000000000001', 'editor@reason.local'),
  ('bcbcbcbc-0000-4000-8000-000000000002', 'member@reason.local');
update public.profiles set role = 'editor' where id = 'bcbcbcbc-0000-4000-8000-000000000001';

insert into public.cart_places (id, name) values ('bcbcbcbc-0000-4000-8000-000000000101', 'Plaza Reason');
insert into public.cart_slots (id, place_id, iso_dow, start_time, end_time) values
  ('bcbcbcbc-0000-4000-8000-000000000201', 'bcbcbcbc-0000-4000-8000-000000000101', 2, '09:00', '11:00');
insert into public.cart_blackouts (id, slot_id, date) values
  ('bcbcbcbc-0000-4000-8000-000000000301', 'bcbcbcbc-0000-4000-8000-000000000201', '2028-01-04');

select has_column('public', 'cart_blackouts', 'reason', 'cart_blackouts has a reason column');
select col_is_null('public', 'cart_blackouts', 'reason', 'reason is nullable');
select is(
  (select reason from public.cart_blackouts where id = 'bcbcbcbc-0000-4000-8000-000000000301'),
  null, 'existing blackouts keep a null reason');

-- Anyone can read the reason (the public Carrito shows it).
set local role anon;
select lives_ok($$select reason from public.cart_blackouts$$, 'anon can read reason');

-- Members cannot write; editors can, up to 60 chars.
reset role;
select tests.login_as('bcbcbcbc-0000-4000-8000-000000000002');
select throws_ok(
  $$insert into public.cart_blackouts (slot_id, date, reason)
    values ('bcbcbcbc-0000-4000-8000-000000000201', '2028-01-11', 'Asamblea')$$,
  '42501', null, 'a member cannot block a turn');

reset role;
select tests.login_as('bcbcbcbc-0000-4000-8000-000000000001');
select lives_ok(
  $$insert into public.cart_blackouts (slot_id, date, reason)
    values ('bcbcbcbc-0000-4000-8000-000000000201', '2028-01-11', 'Asamblea')$$,
  'an editor blocks a turn with a reason');
select lives_ok(
  $$insert into public.cart_blackouts (slot_id, date, reason)
    values ('bcbcbcbc-0000-4000-8000-000000000201', '2028-01-18', repeat('x', 60))$$,
  'a 60-char reason is accepted');
select throws_ok(
  $$insert into public.cart_blackouts (slot_id, date, reason)
    values ('bcbcbcbc-0000-4000-8000-000000000201', '2028-01-25', repeat('x', 61))$$,
  '23514', null, 'a 61-char reason is rejected');

select * from finish();
rollback;
