/**
 * Expected access matrix of the public Data API, per role, derived from supabase/migrations/*.sql,
 * supabase/README.md, docs/ASSIGNMENTS.md and docs/PRIVILEGIOS.md.
 *
 * Table outcomes:
 *   allow  every row is visible / the write goes through
 *   own    only the caller's own rows (profiles.id, device_tokens.user_id)
 *   cols   own row, and only the granted columns (profiles.display_name)
 *   rls    the statement runs but RLS hides every row: SELECT returns 0 rows, UPDATE/DELETE affect
 *          0 rows, INSERT fails with 42501 "new row violates row-level security policy"
 *   deny   no table grant: 42501 "permission denied for table"
 *
 * RPC outcomes: allow, or deny (42501: no EXECUTE grant for anon, explicit role check otherwise).
 */

export const ROLES = [
  'anon',
  'viewer',
  'viewer_linked_duties',
  'can_edit_programa_midweek',
  'can_edit_programa_weekend',
  'can_edit_privilegios',
  'editor',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

export type TableAccess = 'allow' | 'own' | 'cols' | 'rls' | 'deny';
export type Op = 'select' | 'insert' | 'update' | 'delete';
export type TableRow = Record<Op, Record<Role, TableAccess>>;

const all = (a: TableAccess): Record<Role, TableAccess> =>
  Object.fromEntries(ROLES.map((r) => [r, a])) as Record<Role, TableAccess>;

/** anon has no grant; the listed roles pass RLS; every other authenticated role is filtered. */
const gated = (...allowed: Role[]): Record<Role, TableAccess> =>
  Object.fromEntries(
    ROLES.map((r) => [r, r === 'anon' ? 'deny' : allowed.includes(r) ? 'allow' : 'rls']),
  ) as Record<Role, TableAccess>;

const EDITORS: Role[] = ['editor', 'admin'];

/** Schedule data: everyone reads, editors write. */
const publicTable = (...writers: Role[]): TableRow => ({
  select: all('allow'),
  insert: gated(...writers),
  update: gated(...writers),
  delete: gated(...writers),
});

/** PII: editors only, for read and write. */
const editorTable: TableRow = {
  select: gated(...EDITORS),
  insert: gated(...EDITORS),
  update: gated(...EDITORS),
  delete: gated(...EDITORS),
};

/** Privilegios roster: read with sees_privilegios, write with can_edit_privilegios. */
const dutyTable: TableRow = {
  select: gated('viewer_linked_duties', 'can_edit_privilegios', ...EDITORS),
  insert: gated('can_edit_privilegios', ...EDITORS),
  update: gated('can_edit_privilegios', ...EDITORS),
  delete: gated('can_edit_privilegios', ...EDITORS),
};

const ownExceptAnon = (a: TableAccess): Record<Role, TableAccess> => ({ ...all(a), anon: 'deny' });

export const TABLES: Record<string, TableRow> = {
  territories: publicTable(...EDITORS),
  service_weeks: publicTable(...EDITORS),
  service_meetings: publicTable(...EDITORS),
  cart_places: publicTable(...EDITORS),
  cart_slots: publicTable(...EDITORS),
  cart_schedules: publicTable(...EDITORS),
  cart_assignments: publicTable(...EDITORS),
  cart_blackouts: publicTable(...EDITORS),
  // Each program grant writes only its meeting's rows. The matrix is table-level, so both are
  // "allow"; the kind-level RLS is covered by supabase/tests/06_programa_split_test.sql.
  program_weeks: publicTable('can_edit_programa_midweek', 'can_edit_programa_weekend', ...EDITORS),
  people: editorTable,
  person_availability: editorTable,
  person_pairs: editorTable,
  duty_roster: dutyTable,
  duty_days: dutyTable,
  profiles: {
    select: ownExceptAnon('own'),
    insert: all('deny'),
    update: ownExceptAnon('cols'),
    delete: all('deny'),
  },
  device_tokens: {
    select: ownExceptAnon('own'),
    insert: ownExceptAnon('own'),
    update: ownExceptAnon('own'),
    delete: ownExceptAnon('own'),
  },
  reminder_log: { select: all('deny'), insert: all('deny'), update: all('deny'), delete: all('deny') },
};

export interface RpcSpec {
  allowed: Role[];
  /** Writes when allowed. Never called against the hosted project. */
  mutating: boolean;
}

const SIGNED_IN = ROLES.filter((r) => r !== 'anon');
const PEOPLE_PICKERS: Role[] = [
  'can_edit_programa_midweek',
  'can_edit_programa_weekend',
  'can_edit_privilegios',
  ...EDITORS,
];

export const RPCS: Record<string, RpcSpec> = {
  is_editor: { allowed: SIGNED_IN, mutating: false },
  is_admin: { allowed: SIGNED_IN, mutating: false },
  my_assignments: { allowed: SIGNED_IN, mutating: false },
  my_link: { allowed: SIGNED_IN, mutating: false },
  my_permissions: { allowed: SIGNED_IN, mutating: false },
  list_accounts: { allowed: EDITORS, mutating: false },
  name_sources: { allowed: EDITORS, mutating: false },
  duty_people: { allowed: ['can_edit_privilegios', ...EDITORS], mutating: false },
  people_directory: { allowed: PEOPLE_PICKERS, mutating: false },
  reminder_candidates: { allowed: [], mutating: false },
  link_account: { allowed: EDITORS, mutating: true },
  add_person_alias: { allowed: EDITORS, mutating: true },
  create_person_from_name: { allowed: PEOPLE_PICKERS, mutating: true },
  set_account_role: { allowed: ['admin'], mutating: true },
  set_account_permissions: { allowed: ['admin'], mutating: true },
};

/** Tables in the supabase_realtime publication that only some signed-in roles may read. */
export const REALTIME_RESTRICTED = ['people', 'person_availability', 'person_pairs', 'duty_roster', 'duty_days'];
/** Positive control: a public table every subscriber must get events from. */
export const REALTIME_CONTROL = 'cart_places';

export const EDGE_FUNCTIONS = ['send-reminders', 'workbook'] as const;
