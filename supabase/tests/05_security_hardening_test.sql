-- Security hardening (migration security_hardening): realtime publication, admin accounts,
-- Web Push endpoint allow-list, device cap, pg_net reachability, invoker trigger.
begin;
create extension if not exists pgtap with schema extensions;

select plan(40);

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
create function tests.web_token(endpoint text) returns text
language sql immutable as $$
  select json_build_object('endpoint', endpoint, 'expirationTime', null,
    'keys', json_build_object('p256dh', 'BPk', 'auth', 'xyz'))::text;
$$;
grant execute on all functions in schema tests to anon, authenticated;

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'viewer@sec.test'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'editor@sec.test'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'admin@sec.test'),
  ('eeeeeeee-0000-4000-8000-000000000004', 'admin2@sec.test');
update public.profiles set role = 'editor' where id = 'eeeeeeee-0000-4000-8000-000000000002';
update public.profiles set role = 'admin'
 where id in ('eeeeeeee-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000004');

insert into public.people (id, name, gender) values
  ('ffffffff-0000-4000-8000-000000000001', 'Persona Seguridad Uno', 'F'),
  ('ffffffff-0000-4000-8000-000000000002', 'Persona Seguridad Dos', 'M');
update public.profiles set person_id = 'ffffffff-0000-4000-8000-000000000002'
 where id = 'eeeeeeee-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- Realtime publication: public schedule tables only
-- ---------------------------------------------------------------------------
select set_eq(
  $$select tablename::text from pg_publication_tables where pubname = 'supabase_realtime'$$,
  array['territories', 'service_weeks', 'service_meetings', 'cart_places', 'cart_slots',
        'cart_schedules', 'cart_assignments', 'cart_blackouts', 'program_weeks'],
  'supabase_realtime publishes exactly the 9 public schedule tables'
);
select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime'
      and not has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'select')),
  0,
  'every published table is anon-readable (DELETE events bypass RLS)'
);

-- ---------------------------------------------------------------------------
-- pg_net reachability (the grants themselves belong to supabase_admin)
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'private.invoke_send_reminders()', 'execute')
  and not has_function_privilege('authenticated', 'private.invoke_send_reminders()', 'execute'),
  'the only net.http_post caller is not executable by anon/authenticated'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* '\mnet\.http_'
      and p.oid <> 'private.invoke_send_reminders()'::regprocedure),
  0,
  'no other public/private function calls pg_net'
);

-- ---------------------------------------------------------------------------
-- Admin accounts: editors cannot link, relink, unlink, re-role or re-permission them
-- ---------------------------------------------------------------------------
select tests.login_as('eeeeeeee-0000-4000-8000-000000000002'); -- editor

select throws_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-000000000001')$$,
  '42501', null, 'editor cannot link an unlinked admin account');
select throws_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000004', 'ffffffff-0000-4000-8000-000000000001')$$,
  '42501', null, 'editor cannot relink an admin account');
select throws_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000004', null)$$,
  '42501', null, 'editor cannot unlink an admin account');
select throws_ok(
  $$select public.set_account_role('eeeeeeee-0000-4000-8000-000000000003', 'viewer')$$,
  '42501', null, 'editor cannot demote an admin');
select throws_ok(
  $$select public.set_account_permissions('eeeeeeee-0000-4000-8000-000000000003', false, false)$$,
  '42501', null, 'editor cannot change an admin''s permissions');
select lives_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001')$$,
  'editor can still link a viewer account');
select lives_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000002', null)$$,
  'editor can still (un)link their own account');

reset role;
select is(
  (select person_id from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000004'),
  'ffffffff-0000-4000-8000-000000000002'::uuid,
  'the admin link is unchanged after the refused editor calls'
);
select is(
  (select role from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000003'),
  'admin',
  'the admin role is unchanged after the refused editor calls'
);

select tests.login_as('eeeeeeee-0000-4000-8000-000000000003'); -- admin
select lives_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000004', null)$$,
  'admin can unlink another admin');
select lives_ok(
  $$select public.link_account('eeeeeeee-0000-4000-8000-000000000003', 'ffffffff-0000-4000-8000-000000000002')$$,
  'admin can link their own account');
reset role;
select is(
  (select person_id from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000003'),
  'ffffffff-0000-4000-8000-000000000002'::uuid,
  'admin link applied'
);

-- ---------------------------------------------------------------------------
-- Web Push endpoint allow-list (device_tokens_web_push_endpoint)
-- ---------------------------------------------------------------------------
select ok(private.is_web_push_token(tests.web_token('https://fcm.googleapis.com/fcm/send/abc')), 'FCM endpoint allowed');
select ok(private.is_web_push_token(tests.web_token('https://updates.push.services.mozilla.com/wpush/v2/abc')), 'Mozilla endpoint allowed');
select ok(private.is_web_push_token(tests.web_token('https://web.push.apple.com/QK7abc')), 'Apple web push endpoint allowed');
select ok(private.is_web_push_token(tests.web_token('https://wns2-par02p.notify.windows.com/w/?token=abc')), 'WNS endpoint allowed');
select ok(private.is_web_push_token(tests.web_token('https://api.push.apple.com/3/device/abc')), '*.push.apple.com endpoint allowed');
select ok(not private.is_web_push_token(tests.web_token('http://fcm.googleapis.com/fcm/send/abc')), 'http endpoint refused');
select ok(not private.is_web_push_token(tests.web_token('https://fcm.googleapis.com.evil.test/x')), 'suffix lookalike refused');
select ok(not private.is_web_push_token(tests.web_token('https://evilfcm.googleapis.com/x')), 'prefix lookalike refused');
select ok(not private.is_web_push_token(tests.web_token('https://fcm.googleapis.com@evil.test/x')), 'userinfo trick refused');
select ok(not private.is_web_push_token(tests.web_token('https://fcm.googleapis.com:8443/x')), 'explicit port refused');
select ok(not private.is_web_push_token(tests.web_token('https://push.services.mozilla.com/x')), 'bare mozilla parent domain refused');
select ok(not private.is_web_push_token(tests.web_token('https://169.254.169.254/latest')), 'IP literal refused');
select ok(not private.is_web_push_token('not json at all'), 'non-JSON token refused (no exception)');
select ok(not private.is_web_push_token('"https://fcm.googleapis.com/x"'), 'JSON string (no endpoint field) refused');

select tests.login_as('eeeeeeee-0000-4000-8000-000000000001'); -- viewer
select throws_ok(
  format($$insert into public.device_tokens (token, platform) values (%L, 'web')$$,
    tests.web_token('https://169.254.169.254/latest/meta-data')),
  '23514', null, 'viewer cannot store a web token pointing at an arbitrary host');
select lives_ok(
  format($$insert into public.device_tokens (token, platform) values (%L, 'web')$$,
    tests.web_token('https://fcm.googleapis.com/fcm/send/sec-test-1')),
  'viewer can store a real push service subscription');
select lives_ok(
  $$insert into public.device_tokens (token, platform) values ('native-token-not-a-url', 'android')$$,
  'native (android/ios) tokens are not URL-checked');

-- Device cap: 2 rows so far, 18 more fit, the 21st is refused.
select lives_ok(
  $$insert into public.device_tokens (token, platform)
    select 'native-cap-token-' || g, 'ios' from generate_series(1, 18) g$$,
  'up to 20 device tokens per account');
select throws_ok(
  $$insert into public.device_tokens (token, platform) values ('native-cap-token-21', 'ios')$$,
  '54000', null, 'the 21st device token is refused');
reset role;
select is(
  (select count(*)::int from public.device_tokens where user_id = 'eeeeeeee-0000-4000-8000-000000000001'),
  20,
  'viewer has exactly 20 tokens'
);

-- ---------------------------------------------------------------------------
-- fill_meeting_conductor runs as the caller and still fills the name for editors
-- ---------------------------------------------------------------------------
select is(
  (select prosecdef from pg_proc where oid = 'private.fill_meeting_conductor()'::regprocedure),
  false,
  'fill_meeting_conductor is SECURITY INVOKER'
);
insert into public.service_weeks (id, week_start) values ('eeeeeeee-0000-4000-8000-000000000101', '2027-08-02');
select tests.login_as('eeeeeeee-0000-4000-8000-000000000002'); -- editor
select lives_ok(
  $$insert into public.service_meetings (id, week_id, dow, conductor, conductor_person_id)
    values ('eeeeeeee-0000-4000-8000-000000000201', 'eeeeeeee-0000-4000-8000-000000000101', 2,
            'texto', 'ffffffff-0000-4000-8000-000000000001')$$,
  'editor can write a meeting with a conductor person');
reset role;
select is(
  (select conductor from public.service_meetings where id = 'eeeeeeee-0000-4000-8000-000000000201'),
  'Persona Seguridad Uno',
  'conductor name filled from people'
);

-- ---------------------------------------------------------------------------
-- Default privileges: new sequences in public grant nothing to the API roles
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_default_acl d
     join pg_namespace n on n.oid = d.defaclnamespace
     cross join lateral aclexplode(d.defaclacl) a
    where n.nspname = 'public'
      and d.defaclrole = 'postgres'::regrole
      and d.defaclobjtype = 'S'
      and a.grantee in ('anon'::regrole, 'authenticated'::regrole)),
  0,
  'postgres default privileges on public sequences grant nothing to anon/authenticated'
);

select * from finish();
rollback;
