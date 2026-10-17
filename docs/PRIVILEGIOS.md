# People directory, program editor and Privilegios roster: contract

Owner requests (2026-10-17):
1. Every name that has assignments (carrito, programa, salidas, privilegios) must exist as a person,
   so accounts can be linked to people who are not in the carrito.
2. Editors (and people granted permission) edit the meeting program by hand, week by week or as a
   month, besides uploading PDFs.
3. A "Privilegios" roster (Computadora, Sonido, Microfonistas, Acomodadores) per meeting day
   (Tuesday and Saturday). Visible to editors and to members linked to a person tagged for those
   roles; editable by editors and people granted permission. It feeds Mis asignaciones + reminders.

## Database (one new migration)

### People directory
- `people.gender` stays M/F (required for carrito); existing rows unchanged.
- `people.in_carrito boolean not null default true`. The carrito scheduler and carrito pickers only
  use people with `in_carrito`. Existing rows stay `true`; people created from other areas default to
  `false` via the RPC below.
- `people.duties text[] not null default '{}'`, values in `('computadora','sonido','microfonista','acomodador')`
  (check constraint). Which privilegios a person can take.
- `public.name_sources()` (editor only, SECURITY DEFINER) → `(name text, norm text, sources text[], uses int,
  first_date date, last_date date, person_id uuid null, person_name text null)`: every distinct name
  found in `program_weeks` (midweek parts people, weekend presidente/conductor/lector/orador/oración),
  `service_meetings.conductor` and `duty_roster.person_name` (rows without person_id), with the person it
  already matches (by `private.norm_name` on name or aliases), or null.
- `public.create_person_from_name(p_name text, p_gender text, p_in_carrito boolean default false)` → uuid (editor).
- `public.add_person_alias(p_person uuid, p_alias text)` (editor): appends to `aliases` if not present.

### Permissions
- `profiles.can_edit_programa boolean not null default false`,
  `profiles.can_edit_privilegios boolean not null default false`. Editors/admins can always edit both.
- `public.set_account_permissions(p_user uuid, p_programa boolean, p_privilegios boolean)` (admin only).
- `list_accounts()` gains `can_edit_programa`, `can_edit_privilegios`.
- `public.my_permissions()` → `(role text, can_edit_programa boolean, can_edit_privilegios boolean,
  sees_privilegios boolean)` for the caller. `sees_privilegios` = editor/admin OR can_edit_privilegios OR
  linked person has any duty.
- `program_weeks` INSERT/UPDATE/DELETE allowed to editors OR `can_edit_programa` (helper
  `private.can_edit_programa()`).

### Privilegios roster
- `public.duty_roster(id uuid pk, date date not null, role text not null check in
  ('computadora','sonido','microfonista','acomodador'), slot smallint not null check 1..4,
  person_id uuid null references people on delete set null, person_name text null (free text when not
  matched, max 80), note text null, unique (date, role, slot), updated_at/version/updated_by + bump trigger)`.
- `public.duty_days(date date pk, kind text check in ('normal','asamblea','sin_reunion'), note text null, + meta)`:
  marks assembly weeks etc.
- RLS: SELECT for editors, `can_edit_privilegios`, and users whose linked person has any duty
  (helper `private.sees_privilegios()`). Write for editors OR `can_edit_privilegios`. No anon access.
- `assignments_for_person` gains kind `privilegio`: title = role label (Computadora, Sonido, Micrófono,
  Acomodador), date = roster date, start_time = '19:30' on Tuesday / '18:00' on Saturday is NOT known:
  leave start_time null; key = `privilegio:<date>:<role>:<slot>`. Reminders include it automatically.

### Data package
- Zod schemas + repos + hooks: `useNameSources`, `createPersonFromName`, `addPersonAlias`,
  `useMyPermissions`, `setAccountPermissions`, `useDutyRoster(from, to)` (rows + days),
  `upsertDutyCell({date, role, slot, person_id|null, person_name|null})` (CAS on existing row),
  `clearDutyCell`, `setDutyDay`, `useProgramWeeks(from, to)` + `saveProgramWeek(kind, date, data, version?)`
  (insert or CAS update) + `deleteProgramWeek`.

## Web
- Gestión ▸ Personas: tags (duties) + "En carrito" toggle per person; panel "Nombres sin vincular" from
  `name_sources()` (unmatched first): "Crear persona" (asks gender, prefilled from inferGender) or
  "Es otro nombre de…" (person picker → alias).
- Gestión ▸ Usuarios: admin toggles "Puede editar programa" / "Puede editar privilegios".
- Gestión ▸ Programa: tabs "Cargar PDF" (existing) and "Editar": month picker → list of the month's
  weeks; each week expands into a midweek editor (parts: section, time, title, people+role rows; add,
  remove, reorder) and a weekend editor (presidente, discurso tipo/título/orador/congregación, conductor,
  lector, oración final, asamblea). Save per week (CAS). "Copiar estructura de la semana anterior".
- Privilegios: member route `/privilegios` (lazy) listed in the account sheet and as a link on Programa,
  shown only when `my_permissions().sees_privilegios`; table by date (Tue/Sat) with columns
  Computadora, Sonido, Micrófonos, Acomodadores, own name bold, assembly rows as a banner row.
  Editing (editors/can_edit_privilegios): Gestión ▸ Privilegios month grid with person pickers filtered
  by duty, plus "Pegar desde Excel": paste rows `FECHA | COMPUTADORA | SONIDO | MIC 1 | MIC 2 [| ACOM...]`
  (dates like "MARTES 1-sep" or "13/10"), names resolved by first name / full name / alias against people
  with that duty; unresolved shown for confirmation; "ASAMBLEA ..." rows mark the day.
- Gestión access: users with only `can_edit_programa`/`can_edit_privilegios` see Gestión with only those
  sections.
