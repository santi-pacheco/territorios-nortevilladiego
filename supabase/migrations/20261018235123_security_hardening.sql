-- Security hardening from the 2026-10-18 reviews (database B1–B9, client access A-F1/F4).
--
--   realtime        restricted tables leave supabase_realtime (DELETE events skip RLS and leaked
--                   their primary keys to any signed-in subscriber); editors refetch instead
--   link_account    only admins may link, relink or unlink an admin's account
--   device_tokens   web tokens must point at a known Web Push service; at most 20 per user
--   triggers        fill_meeting_conductor runs as the caller (only editors write meetings)
--   defaults        new sequences in public grant nothing to anon/authenticated
--
-- Not fixable here (owner/support, see supabase/README.md "Security: owner checklist"):
--   * pg_net: every grant on net.* and on schema net was made by supabase_admin (event trigger
--     extensions.grant_pg_net_access). postgres is neither superuser nor a member of
--     supabase_admin, so `revoke ... from anon, authenticated` is a silent no-op and
--     `granted by supabase_admin` fails ("grantor must be current user"). net is not an exposed
--     schema and the only caller, private.invoke_send_reminders(), is not executable by
--     anon/authenticated (pgTAP 05 guards both).
--   * default privileges of supabase_admin on public: same reason.

-- ---------------------------------------------------------------------------
-- Realtime: only the anon-readable schedule tables stay published.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime drop table
  public.people, public.person_availability, public.person_pairs,
  public.duty_roster, public.duty_days;

-- ---------------------------------------------------------------------------
-- link_account: editors may not touch admin accounts.
-- ---------------------------------------------------------------------------
create or replace function public.link_account(p_user uuid, p_person uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_editor() then
    raise exception 'link_account: editor role required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'link_account: unknown user' using errcode = 'P0002';
  end if;
  -- Relinking an admin would redirect their reminders and "Mis asignaciones"; admins only.
  if not public.is_admin() and exists (
    select 1 from public.profiles pr where pr.id = p_user and pr.role = 'admin'
  ) then
    raise exception 'link_account: admin role required for an admin account' using errcode = '42501';
  end if;
  if p_person is not null and not exists (select 1 from public.people p where p.id = p_person) then
    raise exception 'link_account: unknown person' using errcode = 'P0002';
  end if;
  if p_person is not null and exists (
    select 1 from public.profiles pr where pr.person_id = p_person and pr.id <> p_user
  ) then
    raise exception 'Esa persona ya está vinculada a otra cuenta' using errcode = '23505';
  end if;

  insert into public.profiles as pr (id, role, person_id)
  values (p_user, 'viewer', p_person)
  on conflict (id) do update set person_id = excluded.person_id
   where pr.person_id is distinct from excluded.person_id;
end;
$$;
comment on function public.link_account(uuid, uuid) is
  'Link an account to a people row (null unlinks). Editor/admin; an admin''s account only by an admin.';

revoke all on function public.link_account(uuid, uuid) from public, anon;
grant execute on function public.link_account(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- device_tokens: web subscriptions must target a known push service.
-- Keep the host list in sync with supabase/functions/send-reminders/lib.ts (PUSH_HOSTS) and
-- packages/data/src/repos/accounts.ts (isAllowedPushEndpoint).
-- ---------------------------------------------------------------------------
create or replace function private.is_web_push_token(p_token text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_endpoint text;
begin
  v_endpoint := (p_token::jsonb) ->> 'endpoint';
  return coalesce(lower(v_endpoint) ~ (
    '^https://('
    || 'fcm\.googleapis\.com'
    || '|web\.push\.apple\.com'
    || '|([a-z0-9-]+\.)+(push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)'
    || ')(/|$)'), false);
exception
  when others then
    return false; -- not JSON, or not an object
end;
$$;
comment on function private.is_web_push_token(text) is
  'True when a Web Push subscription JSON has an https endpoint on an allow-listed push service host.';

-- The CHECK runs as the inserting role, so it needs EXECUTE (harmless: pure function).
revoke all on function private.is_web_push_token(text) from public, anon, authenticated;
grant execute on function private.is_web_push_token(text) to authenticated;

-- NOT VALID: existing rows are not re-checked (send-reminders deletes unusable ones); every
-- new or changed row is.
alter table public.device_tokens
  add constraint device_tokens_web_push_endpoint
  check (platform <> 'web' or private.is_web_push_token(token)) not valid;

create or replace function private.limit_device_tokens()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Counted under the caller's RLS (own rows); a forged user_id is refused by the policy anyway.
  if (select count(*) from public.device_tokens t where t.user_id = new.user_id) >= 20 then
    raise exception 'device_tokens: too many devices for this account' using errcode = '54000';
  end if;
  return new;
end;
$$;
comment on function private.limit_device_tokens() is
  'BEFORE INSERT on device_tokens: at most 20 tokens per account (abuse cap for self-registered accounts).';
revoke all on function private.limit_device_tokens() from public, anon, authenticated;

create trigger device_tokens_limit
  before insert on public.device_tokens
  for each row execute function private.limit_device_tokens();

-- ---------------------------------------------------------------------------
-- fill_meeting_conductor: only editors write service_meetings and they can read people, and
-- sync_meetings_from_people (DEFINER) still reaches it as postgres. No DEFINER needed.
-- ---------------------------------------------------------------------------
alter function private.fill_meeting_conductor() security invoker;
comment on function private.fill_meeting_conductor() is
  'BEFORE INSERT/UPDATE on service_meetings: conductor = people.name when conductor_person_id is set. Runs as the caller.';

-- ---------------------------------------------------------------------------
-- Default privileges: sequences postgres creates in public grant nothing to the API roles.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on sequences from anon, authenticated;
