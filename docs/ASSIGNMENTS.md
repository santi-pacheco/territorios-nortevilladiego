# Member accounts, "Mis asignaciones" and reminders: contract

Owner decisions (2026-10-16): members sign in with **Google**; an editor links each account to a
`people` row; assignments = **carrito turns, program parts, conducting a salida**; reminders
**7 days and 1 day before**; delivery = installable web app (Web Push on Android and iPhone),
Google Play app later on the same backend.

## Database (new migration, never edit old ones)

- `profiles.person_id uuid unique null references people(id) on delete set null`.
  Clients cannot write it; only the editor RPCs below.
- `people.aliases text[] not null default '{}'`: other spellings of the person's name as they
  appear in program PDFs or as salida conductor (e.g. "D. Gomez"). Editor-writable like the rest of `people`.
- Trigger on `auth.users` insert → `profiles(id, role 'viewer', display_name = raw_user_meta_data.full_name)`.
- Name matching: `private.norm_name(text)` = lower(unaccent(trim)), collapse spaces. A person matches
  a text when `norm_name(text)` equals `norm_name(people.name)` or any alias.
- `private.assignments_for_person(p_person uuid, p_from date, p_to date)` returns
  `(key text, kind text, date date, start_time text, title text, place text, role text, detail text)`:
  - `carrito`: every `cart_assignments` cell containing the person. date = `week_date + (slot.iso_dow - 1)`,
    start_time = slot.start_time, title = place name, place = place name, role = null,
    detail = other people's names (from `person_names`) + note. Skip blacked-out dates.
    key = `carrito:<assignment id>:<date>`.
  - `programa`: midweek `program_weeks.data.parts[].people[]` (name, role) matched by name →
    title = part title, role = role (e.g. "Lector"), date = the week's Tuesday (midweek) / Saturday (weekend);
    weekend fields `conductor`, `lector`, `discurso.orador` (title = discurso.titulo).
    key = `programa:<kind>:<date>:<index or field>`.
  - `salida`: `service_meetings.conductor` matched by name; date = week_start + dow offset (dow 0 = Sunday,
    week_start is Monday), title = place, role = 'Conductor'. key = `salida:<meeting id>`.
- `public.my_assignments(p_from date default current_date, p_to date default current_date + 90)`
  SECURITY DEFINER, `search_path = ''`: assignments of the caller's linked person; empty if not linked.
  Execute granted to `authenticated` only.
- `public.my_link()` → `(person_id uuid, person_name text)` for the caller (so the UI can say "Vinculado como X").
- Editor RPCs (SECURITY DEFINER, check `private.is_editor()` / `is_admin()` inside):
  - `public.list_accounts()` → `(user_id, email, display_name, avatar_url, provider, role, person_id, person_name, created_at)`.
  - `public.link_account(p_user uuid, p_person uuid null)`: editor; null unlinks.
  - `public.set_account_role(p_user uuid, p_role text)`: admin only; cannot demote the last admin.
- Web Push subscriptions reuse `device_tokens` with `platform = 'web'` and `token` = the
  `PushSubscription` JSON string. Users manage only their own rows (existing RLS).
- `public.reminder_log(user_id uuid, assignment_key text, offset_days int, sent_at timestamptz,
  primary key (user_id, assignment_key, offset_days))`: no client access.
- pgTAP tests for: trigger, matching (accents, aliases), each kind, RLS of RPCs (viewer sees only own,
  non-editor cannot list/link, non-admin cannot set role).

## Reminder sender

- Edge Function `supabase/functions/send-reminders` (Deno, `npm:web-push`). Env: `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `REMINDER_SECRET` (shared with the cron call).
- Runs daily at 09:00 America/Argentina/Buenos_Aires (12:00 UTC) via `pg_cron` + `pg_net`
  (migration schedules it; reads the function URL and secret from Vault secrets
  `reminders_url`, `reminders_secret`, documented in supabase/README.md).
- For each linked user with web subscriptions: assignments with date = today+7 and today+1 that are not
  in `reminder_log` → push `{title, body, url: "/mis-asignaciones"}`; Spanish copy, e.g.
  "Carrito en 7 días: martes 21 · 09:00 · Plaza" / "Mañana: Lectura de la Biblia (Lector)".
  Log each send; delete subscriptions that answer 404/410.
- `--dry-run` mode via request body `{dryRun: true}` returns what would be sent.

## Web (apps/web)

- Account sheet: "Entrar con Google" (supabase `signInWithOAuth({provider:'google', options:{redirectTo: location.origin + '/mis-asignaciones'}})`)
  for members; the existing email/password form moves under "Soy encargado" (collapsed).
- Route `/mis-asignaciones` (lazy): signed out → explain + Google button; signed in but not linked →
  "Pedile a un encargado que vincule tu cuenta" + their display name/email; linked → list grouped by
  week, each row: date (weekday + day), time, kind marker, title, role, place, detail; "Próxima" first.
  Button "Activar recordatorios" (Notification permission + `pushManager.subscribe` with
  `VITE_VAPID_PUBLIC_KEY` + insert into `device_tokens`), state shown, "Desactivar". On iPhone, if not
  installed (no `navigator.standalone`), explain "Agregar a pantalla de inicio" first.
- Service worker: push + notificationclick handlers (open/focus `url`) via `workbox.importScripts`.
- Gestión ▸ Usuarios: `list_accounts()` table; per row person picker (people list) → `link_account`;
  role select for admins → `set_account_role`. Editor-only.
- When linked, the member's name replaces the local "Soy…" name for highlighting.
