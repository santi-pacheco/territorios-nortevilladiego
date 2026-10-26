-- Split program-editing permissions: the midweek and weekend meetings have separate grants.
-- (docs/PRIVILEGIOS.md). Fixtures use September 2027 dates and their own UUID prefix.
--
-- RLS-denied UPDATE/DELETE are silent (0 rows): asserted with tests.affected(). A kind switch
-- passes USING (old row) but fails WITH CHECK (new row), so it raises 42501.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

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
grant execute on all functions in schema tests to anon, authenticated;

-- Users: midweek-only, weekend-only, editor, both (granted through the RPC), admin.
insert into auth.users (id, email) values
  ('abababab-0000-4000-8000-000000000001', 'midweek@test.local'),
  ('abababab-0000-4000-8000-000000000002', 'weekend@test.local'),
  ('abababab-0000-4000-8000-000000000003', 'editor@test.local'),
  ('abababab-0000-4000-8000-000000000004', 'both@test.local'),
  ('abababab-0000-4000-8000-000000000005', 'admin@test.local');
update public.profiles set can_edit_programa_midweek = true
 where id = 'abababab-0000-4000-8000-000000000001';
update public.profiles set can_edit_programa_weekend = true
 where id = 'abababab-0000-4000-8000-000000000002';
update public.profiles set role = 'editor' where id = 'abababab-0000-4000-8000-000000000003';
update public.profiles set role = 'admin'  where id = 'abababab-0000-4000-8000-000000000005';

-- Rows to update/delete by kind, plus one pair kept for the editor checks.
insert into public.program_weeks (kind, date, data) values
  ('midweek', '2027-09-07', '{"parts":[]}'),
  ('weekend', '2027-09-11', '{"presidente":"Fixture Uno"}'),
  ('midweek', '2027-09-14', '{"parts":[]}'),
  ('weekend', '2027-09-18', '{"presidente":"Fixture Dos"}');

-- ---------------------------------------------------------------------------
-- Columns and effective permissions
-- ---------------------------------------------------------------------------
select has_column('public', 'profiles', 'can_edit_programa_midweek', 'profiles.can_edit_programa_midweek exists');
select has_column('public', 'profiles', 'can_edit_programa_weekend', 'profiles.can_edit_programa_weekend exists');
select hasnt_column('public', 'profiles', 'can_edit_programa', 'the single program flag is gone');

select tests.login_as('abababab-0000-4000-8000-000000000001');
select results_eq(
  $$select role, can_edit_programa_midweek, can_edit_programa_weekend from public.my_permissions()$$,
  $$values ('viewer'::text, true, false)$$,
  'midweek-only: my_permissions enables the midweek meeting only'
);
select ok(
  (select private.can_edit_programa()),
  'midweek-only: either-grant helper is true for the person pickers'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select results_eq(
  $$select role, can_edit_programa_midweek, can_edit_programa_weekend from public.my_permissions()$$,
  $$values ('viewer'::text, false, true)$$,
  'weekend-only: my_permissions enables the weekend meeting only'
);
select ok(
  (select private.can_edit_programa()),
  'weekend-only: either-grant helper is true for the person pickers'
);

select tests.login_as('abababab-0000-4000-8000-000000000003');
select results_eq(
  $$select role, can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios
      from public.my_permissions()$$,
  $$values ('editor'::text, true, true, true)$$,
  'editor: both meetings are effective without stored grants'
);

-- ---------------------------------------------------------------------------
-- INSERT: only the row's kind grant
-- ---------------------------------------------------------------------------
select tests.login_as('abababab-0000-4000-8000-000000000001');
select lives_ok(
  $$insert into public.program_weeks (kind, date, data) values ('midweek', '2027-09-21', '{"parts":[]}')$$,
  'midweek-only inserts a midweek row'
);
select throws_ok(
  $$insert into public.program_weeks (kind, date, data) values ('weekend', '2027-09-25', '{}')$$,
  '42501', null, 'midweek-only cannot insert a weekend row'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select lives_ok(
  $$insert into public.program_weeks (kind, date, data) values ('weekend', '2027-09-25', '{}')$$,
  'weekend-only inserts a weekend row'
);
select throws_ok(
  $$insert into public.program_weeks (kind, date, data) values ('midweek', '2027-09-28', '{"parts":[]}')$$,
  '42501', null, 'weekend-only cannot insert a midweek row'
);

-- ---------------------------------------------------------------------------
-- UPDATE: the old row needs its grant, the new row needs its own
-- ---------------------------------------------------------------------------
select tests.login_as('abababab-0000-4000-8000-000000000001');
select is(
  tests.affected($$update public.program_weeks set data = '{"parts":[]}' where kind = 'midweek' and date = '2027-09-07'$$),
  1, 'midweek-only updates a midweek row'
);
select is(
  tests.affected($$update public.program_weeks set data = '{}' where kind = 'weekend' and date = '2027-09-11'$$),
  0, 'midweek-only update of a weekend row affects 0 rows'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select is(
  tests.affected($$update public.program_weeks set data = '{}' where kind = 'weekend' and date = '2027-09-11'$$),
  1, 'weekend-only updates a weekend row'
);
select is(
  tests.affected($$update public.program_weeks set data = '{"parts":[]}' where kind = 'midweek' and date = '2027-09-14'$$),
  0, 'weekend-only update of a midweek row affects 0 rows'
);

select tests.login_as('abababab-0000-4000-8000-000000000001');
select throws_ok(
  $$update public.program_weeks set kind = 'weekend' where kind = 'midweek' and date = '2027-09-07'$$,
  '42501', null, 'midweek-only cannot move its row into the weekend meeting'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select throws_ok(
  $$update public.program_weeks set kind = 'midweek' where kind = 'weekend' and date = '2027-09-11'$$,
  '42501', null, 'weekend-only cannot move its row into the midweek meeting'
);

-- ---------------------------------------------------------------------------
-- DELETE: only the row's kind grant
-- ---------------------------------------------------------------------------
select tests.login_as('abababab-0000-4000-8000-000000000001');
select is(
  tests.affected($$delete from public.program_weeks where kind = 'weekend' and date = '2027-09-11'$$),
  0, 'midweek-only delete of a weekend row affects 0 rows'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select is(
  tests.affected($$delete from public.program_weeks where kind = 'midweek' and date = '2027-09-14'$$),
  0, 'weekend-only delete of a midweek row affects 0 rows'
);

select tests.login_as('abababab-0000-4000-8000-000000000001');
select is(
  tests.affected($$delete from public.program_weeks where kind = 'midweek' and date = '2027-09-07'$$),
  1, 'midweek-only deletes a midweek row'
);

select tests.login_as('abababab-0000-4000-8000-000000000002');
select is(
  tests.affected($$delete from public.program_weeks where kind = 'weekend' and date = '2027-09-11'$$),
  1, 'weekend-only deletes a weekend row'
);

-- ---------------------------------------------------------------------------
-- Editors still write both meetings
-- ---------------------------------------------------------------------------
select tests.login_as('abababab-0000-4000-8000-000000000003');
select is(
  tests.affected($$update public.program_weeks set data = '{"parts":[]}' where kind = 'midweek' and date = '2027-09-14'$$),
  1, 'editor updates a midweek row'
);
select is(
  tests.affected($$update public.program_weeks set data = '{}' where kind = 'weekend' and date = '2027-09-18'$$),
  1, 'editor updates a weekend row'
);

-- ---------------------------------------------------------------------------
-- set_account_permissions: null keeps the stored grant
-- ---------------------------------------------------------------------------
select tests.login_as('abababab-0000-4000-8000-000000000005');
select lives_ok(
  $$select public.set_account_permissions('abababab-0000-4000-8000-000000000004', true, false, false);
    select public.set_account_permissions('abababab-0000-4000-8000-000000000004', null, true, null)$$,
  'admin grants midweek, then only the weekend with nulls'
);
select results_eq(
  $$select can_edit_programa_midweek, can_edit_programa_weekend, can_edit_privilegios
      from public.list_accounts() where user_id = 'abababab-0000-4000-8000-000000000004'$$,
  $$values (true, true, false)$$,
  'a null argument keeps the stored grant'
);
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_account_permissions'),
  1,
  'set_account_permissions has a single overload (4 args)'
);

select * from finish();
rollback;
