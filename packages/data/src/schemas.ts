/**
 * Zod schemas for every table in supabase/migrations/*.sql.
 *
 * - `XRow`    : what PostgREST returns (parsed on every read).
 * - `XInsert` : what the client may send on insert (server-owned columns omitted).
 * - `XUpdate` : partial patch for a CAS update (keys + server-owned columns omitted).
 *
 * Server-owned columns are never sent: `version`, `updated_at`, `updated_by` (bump_version
 * trigger) and `cart_assignments.person_names` (fill_assignment_names trigger).
 */
import { z } from 'zod/mini';

/** Bump when a row shape changes: busts the persisted query cache. */
export const SCHEMA_VERSION = '2026-10-26.1';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
/** Postgres uuid. `guid` (not `uuid`) so non-RFC seed ids still parse. */
export const Uuid = z.guid();
/** `date` column: YYYY-MM-DD. */
export const IsoDate = z.iso.date();
/** `timestamptz` as PostgREST prints it: 2026-10-16T18:50:13.123456+00:00 */
export const Timestamp = z.iso.datetime({ offset: true });
/** `time` column: HH:MM or HH:MM:SS (PostgREST returns HH:MM:SS). */
export const TimeOfDay = z
  .string()
  .check(z.regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM[:SS]'));

/** ISO day of week (1 = Monday … 7 = Sunday) for a YYYY-MM-DD string. */
export function isoDow(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const isMonday = (d: string) => isoDow(d) === 1;

const Meta = {
  updated_at: Timestamp,
  version: z.int().check(z.minimum(1)),
  updated_by: z.nullable(Uuid),
};

/** Columns the client must never send. */
const SERVER_OWNED = { updated_at: true, version: true, updated_by: true } as const;

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
export const Role = z.enum(['viewer', 'editor', 'admin']);
export type Role = z.infer<typeof Role>;

const DisplayName = z.nullable(z.string().check(z.minLength(1), z.maxLength(80)));

export const ProfileRow = z.object({
  id: Uuid,
  role: Role,
  display_name: DisplayName,
  /** Linked people row. Written only through the link_account RPC (no column grant). */
  person_id: z.optional(z.nullable(Uuid)),
  /** Stored grants (docs/PRIVILEGIOS.md). Written only through set_account_permissions. */
  can_edit_programa_midweek: z.optional(z.boolean()),
  can_edit_programa_weekend: z.optional(z.boolean()),
  can_edit_privilegios: z.optional(z.boolean()),
  ...Meta,
});
export type ProfileRow = z.infer<typeof ProfileRow>;
/** Only `display_name` has a column grant for authenticated users. */
export const ProfileUpdate = z.object({ display_name: DisplayName });
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

// ---------------------------------------------------------------------------
// territories
// ---------------------------------------------------------------------------
const Position = z.array(z.number()).check(z.minLength(2));
const Ring = z.array(Position);
export const TerritoryGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring)) }),
]);
export type TerritoryGeometry = z.infer<typeof TerritoryGeometry>;

export const TerritoryRow = z.object({
  id: z.int().check(z.positive()),
  name: z.string().check(z.minLength(1), z.maxLength(120)),
  geometry: TerritoryGeometry,
  centroid_lng: z.number().check(z.minimum(-180), z.maximum(180)),
  centroid_lat: z.number().check(z.minimum(-90), z.maximum(90)),
  ...Meta,
});
export type TerritoryRow = z.infer<typeof TerritoryRow>;
export const TerritoryInsert = z.omit(TerritoryRow, SERVER_OWNED);
export type TerritoryInsert = z.infer<typeof TerritoryInsert>;
export const TerritoryUpdate = z.partial(z.omit(TerritoryInsert, { id: true }));
export type TerritoryUpdate = z.infer<typeof TerritoryUpdate>;

// ---------------------------------------------------------------------------
// service_weeks / service_meetings (Salidas)
// ---------------------------------------------------------------------------
export const ServiceWeekRow = z.object({
  id: Uuid,
  week_start: IsoDate.check(z.refine(isMonday, 'week_start must be a Monday')),
  month_label: z.string().check(z.maxLength(40)),
  ...Meta,
});
export type ServiceWeekRow = z.infer<typeof ServiceWeekRow>;
export const ServiceWeekInsert = z.extend(z.omit(ServiceWeekRow, SERVER_OWNED), {
  id: z.optional(Uuid),
  month_label: z.optional(z.string().check(z.maxLength(40))),
});
export type ServiceWeekInsert = z.infer<typeof ServiceWeekInsert>;
export const ServiceWeekUpdate = z.partial(
  z.pick(ServiceWeekRow, { week_start: true, month_label: true }),
);
export type ServiceWeekUpdate = z.infer<typeof ServiceWeekUpdate>;

export const MeetingKind = z.enum(['normal', 'domingo']);
export type MeetingKind = z.infer<typeof MeetingKind>;
const TerritoryIds = z.array(z.int()).check(z.maxLength(60));
/** Domingo-only per-group layout: keys G1..G4 only. */
export const GroupTerritories = z.strictObject({
  G1: z.optional(z.array(z.int())),
  G2: z.optional(z.array(z.int())),
  G3: z.optional(z.array(z.int())),
  G4: z.optional(z.array(z.int())),
});
export type GroupTerritories = z.infer<typeof GroupTerritories>;

const meetingFields = {
  id: Uuid,
  week_id: Uuid,
  /** JS numbering: 0 = Domingo … 6 = Sábado. */
  dow: z.int().check(z.minimum(0), z.maximum(6)),
  position: z.int().check(z.minimum(0), z.maximum(99)),
  kind: MeetingKind,
  start_time: z.string().check(z.maxLength(20)),
  groups: z.string().check(z.maxLength(120)),
  /** Display snapshot: people.name when conductor_person_id is set (trigger), free text otherwise. */
  conductor: z.string().check(z.maxLength(120)),
  /** The person conducting; null = free text / legacy. Optional so a pre-migration row still parses. */
  conductor_person_id: z.optional(z.nullable(Uuid)),
  place: z.string().check(z.maxLength(200)),
  territory_ids: TerritoryIds,
  group_territories: GroupTerritories,
};

/** Mirrors service_meetings_kind_dow and the domingo-only group_territories check. */
function meetingInvariants(
  m: {
    dow?: number | undefined;
    kind?: MeetingKind | undefined;
    group_territories?: GroupTerritories | undefined;
  },
  ctx: z.core.$RefinementCtx,
): void {
  if (m.dow !== undefined && m.kind !== undefined && (m.kind === 'domingo') !== (m.dow === 0)) {
    ctx.addIssue({ code: 'custom', path: ['kind'], message: 'kind "domingo" iff dow = 0' });
  }
  if (m.kind === 'normal' && m.group_territories && Object.keys(m.group_territories).length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['group_territories'],
      message: 'group_territories is Domingo only',
    });
  }
}

export const ServiceMeetingRow = z
  .object({ ...meetingFields, ...Meta })
  .check(z.superRefine(meetingInvariants));
export type ServiceMeetingRow = z.infer<typeof ServiceMeetingRow>;
export const ServiceMeetingInsert = z
  .object({
    ...meetingFields,
    id: z.optional(Uuid),
    position: z.optional(meetingFields.position),
    kind: z.optional(MeetingKind),
    start_time: z.optional(meetingFields.start_time),
    groups: z.optional(meetingFields.groups),
    conductor: z.optional(meetingFields.conductor),
    conductor_person_id: meetingFields.conductor_person_id,
    place: z.optional(meetingFields.place),
    territory_ids: z.optional(TerritoryIds),
    group_territories: z.optional(GroupTerritories),
  })
  .check(z.superRefine(meetingInvariants));
export type ServiceMeetingInsert = z.infer<typeof ServiceMeetingInsert>;
export const ServiceMeetingUpdate = z
  .partial(z.omit(z.object(meetingFields), { id: true, week_id: true }))
  .check(z.superRefine(meetingInvariants));
export type ServiceMeetingUpdate = z.infer<typeof ServiceMeetingUpdate>;

// ---------------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------------
const HexColor = z.string().check(z.regex(/^#[0-9A-Fa-f]{6}$/));

export const CartPlaceRow = z.object({
  id: Uuid,
  name: z.string().check(z.minLength(1), z.maxLength(120)),
  color: HexColor,
  ...Meta,
});
export type CartPlaceRow = z.infer<typeof CartPlaceRow>;
export const CartPlaceInsert = z.object({
  id: z.optional(Uuid),
  name: z.string().check(z.minLength(1), z.maxLength(120)),
  color: z.optional(HexColor),
});
export type CartPlaceInsert = z.infer<typeof CartPlaceInsert>;
export const CartPlaceUpdate = z.partial(z.omit(CartPlaceInsert, { id: true }));
export type CartPlaceUpdate = z.infer<typeof CartPlaceUpdate>;

/** Compare HH:MM[:SS] strings (lexicographic works after padding seconds). */
const toSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);
function slotTimeOrder(
  s: { start_time?: string | undefined; end_time?: string | undefined },
  ctx: z.core.$RefinementCtx,
) {
  if (s.start_time && s.end_time && toSeconds(s.end_time) <= toSeconds(s.start_time)) {
    ctx.addIssue({
      code: 'custom',
      path: ['end_time'],
      message: 'end_time must be after start_time',
    });
  }
}
const slotFields = {
  id: Uuid,
  place_id: Uuid,
  /** ISO numbering: 1 = Lunes … 7 = Domingo (differs from service_meetings.dow on purpose). */
  iso_dow: z.int().check(z.minimum(1), z.maximum(7)),
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  group_size: z.int().check(z.minimum(1), z.maximum(12)),
  display_label: z.nullable(z.string().check(z.maxLength(80))),
};
export const CartSlotRow = z.object({ ...slotFields, ...Meta }).check(z.superRefine(slotTimeOrder));
export type CartSlotRow = z.infer<typeof CartSlotRow>;
export const CartSlotInsert = z
  .object({
    ...slotFields,
    id: z.optional(Uuid),
    group_size: z.optional(slotFields.group_size),
    display_label: z.optional(slotFields.display_label),
  })
  .check(z.superRefine(slotTimeOrder));
export type CartSlotInsert = z.infer<typeof CartSlotInsert>;
export const CartSlotUpdate = z
  .partial(z.omit(z.object(slotFields), { id: true }))
  .check(z.superRefine(slotTimeOrder));
export type CartSlotUpdate = z.infer<typeof CartSlotUpdate>;

function scheduleRange(
  s: { start_date?: string | undefined; end_date?: string | undefined },
  ctx: z.core.$RefinementCtx,
) {
  if (!s.start_date || !s.end_date) return;
  const days = (Date.parse(s.end_date) - Date.parse(s.start_date)) / 86_400_000;
  if (days < 0 || days > 400) {
    ctx.addIssue({
      code: 'custom',
      path: ['end_date'],
      message: 'end_date must be within 0..400 days of start_date',
    });
  }
}
const scheduleFields = {
  id: Uuid,
  name: z.string().check(z.maxLength(120)),
  start_date: IsoDate,
  end_date: IsoDate,
};
export const CartScheduleRow = z
  .object({ ...scheduleFields, ...Meta })
  .check(z.superRefine(scheduleRange));
export type CartScheduleRow = z.infer<typeof CartScheduleRow>;
export const CartScheduleInsert = z
  .object({ ...scheduleFields, id: z.optional(Uuid), name: z.optional(scheduleFields.name) })
  .check(z.superRefine(scheduleRange));
export type CartScheduleInsert = z.infer<typeof CartScheduleInsert>;
export const CartScheduleUpdate = z
  .partial(z.omit(z.object(scheduleFields), { id: true }))
  .check(z.superRefine(scheduleRange));
export type CartScheduleUpdate = z.infer<typeof CartScheduleUpdate>;

function uniquePeople(a: { person_ids?: string[] | undefined }, ctx: z.core.$RefinementCtx) {
  if (a.person_ids && new Set(a.person_ids).size !== a.person_ids.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['person_ids'],
      message: 'person_ids contains duplicates',
    });
  }
}
const assignmentFields = {
  id: Uuid,
  schedule_id: Uuid,
  slot_id: Uuid,
  week_date: IsoDate.check(z.refine(isMonday, 'week_date must be a Monday')),
  person_ids: z.array(Uuid).check(z.maxLength(12)),
  note: z.nullable(z.string().check(z.maxLength(500))),
};
export const CartAssignmentRow = z
  .object({
    ...assignmentFields,
    /** Trigger-maintained snapshot of people.name (public). Never sent by the client. */
    person_names: z.array(z.string()),
    ...Meta,
  })
  .check(
    z.superRefine(uniquePeople),
    z.refine((a) => a.person_names.length === a.person_ids.length, {
      path: ['person_names'],
      message: 'person_names must match person_ids',
    }),
  );
export type CartAssignmentRow = z.infer<typeof CartAssignmentRow>;
export const CartAssignmentInsert = z
  .object({
    ...assignmentFields,
    id: z.optional(Uuid),
    person_ids: z.optional(assignmentFields.person_ids),
    note: z.optional(assignmentFields.note),
  })
  .check(z.superRefine(uniquePeople));
export type CartAssignmentInsert = z.infer<typeof CartAssignmentInsert>;
export const CartAssignmentUpdate = z
  .partial(z.object({ person_ids: assignmentFields.person_ids, note: assignmentFields.note }))
  .check(z.superRefine(uniquePeople));
export type CartAssignmentUpdate = z.infer<typeof CartAssignmentUpdate>;

/** Label for the banner over a blocked turn ("Asamblea"); null on blackouts made before it existed. */
const blackoutReason = z.nullable(z.string().check(z.maxLength(60)));
export const CartBlackoutRow = z.object({
  id: Uuid,
  slot_id: Uuid,
  date: IsoDate,
  reason: blackoutReason,
  ...Meta,
});
export type CartBlackoutRow = z.infer<typeof CartBlackoutRow>;
export const CartBlackoutInsert = z.object({
  id: z.optional(Uuid),
  slot_id: Uuid,
  date: IsoDate,
  reason: z.optional(blackoutReason),
});
export type CartBlackoutInsert = z.infer<typeof CartBlackoutInsert>;

// ---------------------------------------------------------------------------
// People (editor/admin only — PII)
// ---------------------------------------------------------------------------
export const Gender = z.enum(['M', 'F']);
export type Gender = z.infer<typeof Gender>;
/** Privilegios a person can take (people.duties) and the roster columns (duty_roster.role). */
export const DutyRole = z.enum(['computadora', 'sonido', 'microfonista', 'acomodador']);
export type DutyRole = z.infer<typeof DutyRole>;
/** Rows stay lenient (the DB check allows repeats); writes must not repeat a duty. */
const Duties = z.array(DutyRole);
const UniqueDuties = z
  .array(DutyRole)
  .check(z.refine((d) => new Set(d).size === d.length, 'duties contains duplicates'));
const personFields = {
  id: Uuid,
  name: z.string().check(z.minLength(1), z.maxLength(120)),
  gender: Gender,
  /** 0 = unlimited. */
  target_appearances: z.int().check(z.minimum(0), z.maximum(999)),
  /** Other spellings of the name in program PDFs / as salida conductor (e.g. "D. Perez"). */
  aliases: z.array(z.string().check(z.minLength(1), z.maxLength(120))).check(z.maxLength(20)),
  /** Takes part in the carrito (scheduler + pickers). See `carritoPeople()`. */
  in_carrito: z.boolean(),
  duties: Duties,
};
export const PersonRow = z.object({ ...personFields, ...Meta });
export type PersonRow = z.infer<typeof PersonRow>;
export const PersonInsert = z.object({
  ...personFields,
  id: z.optional(Uuid),
  target_appearances: z.optional(personFields.target_appearances),
  aliases: z.optional(personFields.aliases),
  in_carrito: z.optional(personFields.in_carrito),
  duties: z.optional(UniqueDuties),
});
export type PersonInsert = z.infer<typeof PersonInsert>;
export const PersonUpdate = z.partial(z.omit(PersonInsert, { id: true }));
export type PersonUpdate = z.infer<typeof PersonUpdate>;

export const PersonAvailabilityRow = z.object({ person_id: Uuid, slot_id: Uuid, ...Meta });
export type PersonAvailabilityRow = z.infer<typeof PersonAvailabilityRow>;
export const PersonAvailabilityInsert = z.omit(PersonAvailabilityRow, SERVER_OWNED);
export type PersonAvailabilityInsert = z.infer<typeof PersonAvailabilityInsert>;

/** Stored once with person_a < person_b; a trigger reorders inserts, so either order may be sent. */
export const PersonPairRow = z.object({ person_a: Uuid, person_b: Uuid, ...Meta }).check(
  z.refine((p) => p.person_a < p.person_b, {
    path: ['person_b'],
    message: 'person_a must sort before person_b',
  }),
);
export type PersonPairRow = z.infer<typeof PersonPairRow>;
export const PersonPairInsert = z.object({ person_a: Uuid, person_b: Uuid }).check(
  z.refine((p) => p.person_a !== p.person_b, {
    path: ['person_b'],
    message: 'a person cannot pair with themselves',
  }),
);
export type PersonPairInsert = z.infer<typeof PersonPairInsert>;

// ---------------------------------------------------------------------------
// program_weeks
// ---------------------------------------------------------------------------
export const ProgramKind = z.enum(['midweek', 'weekend']);
export type ProgramKind = z.infer<typeof ProgramKind>;
/** Shape validated by packages/core (MidweekWeek / WeekendMeeting); here: any JSON object. */
export const ProgramData = z.record(z.string(), z.unknown());
export type ProgramData = z.infer<typeof ProgramData>;

/**
 * A person inside program data. Midweek `parts[].people[]` items are objects
 * `{name, role?, person_id?}`; weekend presidente / conductor / lector / oracionFinal and
 * `discurso.orador` are a plain name (legacy, unlinked) or `{name, person_id?}` (linked).
 */
export const ProgramPersonRef = z.looseObject({
  name: z.string().check(z.maxLength(120)),
  person_id: z.optional(Uuid),
});
export const ProgramPersonValue = z.nullable(z.union([z.string(), ProgramPersonRef]));
export const ProgramMidweekPerson = z.looseObject({
  name: z.string().check(z.maxLength(120)),
  role: z.optional(z.string()),
  person_id: z.optional(Uuid),
});
const WEEKEND_PERSON_KEYS = ['presidente', 'conductor', 'lector', 'oracionFinal'] as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Writes only: every person present in the data has one of the accepted shapes (stored rows
 * are read leniently, they may come from v1 or a PDF upload). Legacy strings stay valid.
 */
function programPeopleShape(p: { data?: ProgramData | undefined }, ctx: z.core.$RefinementCtx) {
  const data = p.data;
  if (!data) return;
  const bad = (path: (string | number)[]) =>
    ctx.addIssue({ code: 'custom', path: ['data', ...path], message: 'invalid person' });
  if (Array.isArray(data.parts)) {
    data.parts.forEach((part, i) => {
      if (!isObj(part) || !Array.isArray(part.people)) return;
      part.people.forEach((person, j) => {
        if (!ProgramMidweekPerson.safeParse(person).success) bad(['parts', i, 'people', j]);
      });
    });
  }
  for (const key of WEEKEND_PERSON_KEYS) {
    if (key in data && !ProgramPersonValue.safeParse(data[key]).success) bad([key]);
  }
  const disc = data.discurso;
  if (isObj(disc) && 'orador' in disc && !ProgramPersonValue.safeParse(disc.orador).success) {
    bad(['discurso', 'orador']);
  }
}

function programKeyDay(
  p: { kind?: ProgramKind | undefined; date?: string | undefined },
  ctx: z.core.$RefinementCtx,
) {
  if (!p.kind || !p.date) return;
  const want = p.kind === 'midweek' ? 2 : 6;
  if (isoDow(p.date) !== want) {
    ctx.addIssue({
      code: 'custom',
      path: ['date'],
      message:
        p.kind === 'midweek' ? 'midweek is keyed by a Tuesday' : 'weekend is keyed by a Saturday',
    });
  }
}
const programFields = { id: Uuid, kind: ProgramKind, date: IsoDate, data: ProgramData };
export const ProgramWeekRow = z
  .object({ ...programFields, ...Meta })
  .check(z.superRefine(programKeyDay));
export type ProgramWeekRow = z.infer<typeof ProgramWeekRow>;
export const ProgramWeekInsert = z
  .object({ ...programFields, id: z.optional(Uuid), data: z.optional(ProgramData) })
  .check(z.superRefine(programKeyDay), z.superRefine(programPeopleShape));
export type ProgramWeekInsert = z.infer<typeof ProgramWeekInsert>;
/** kind/date form the natural key; only `data` is patched. */
export const ProgramWeekUpdate = z
  .object({ data: ProgramData })
  .check(z.superRefine(programPeopleShape));
export type ProgramWeekUpdate = z.infer<typeof ProgramWeekUpdate>;

// ---------------------------------------------------------------------------
// duty_roster / duty_days (Privilegios: editors, can_edit_privilegios, tagged members)
// ---------------------------------------------------------------------------
/** Slot within a role on one day: Micrófono 1/2, Acomodador 1..4. */
export const DutySlot = z.int().check(z.minimum(1), z.maximum(4));
const DutyPersonName = z.nullable(z.string().check(z.minLength(1), z.maxLength(120)));
const DutyNote = z.nullable(z.string().check(z.maxLength(500)));

export const DutyRosterRow = z.object({
  id: Uuid,
  date: IsoDate,
  role: DutyRole,
  slot: DutySlot,
  person_id: z.nullable(Uuid),
  /** people.name snapshot when person_id is set (trigger), free text otherwise. Always display this. */
  person_name: DutyPersonName,
  note: DutyNote,
  ...Meta,
});
export type DutyRosterRow = z.infer<typeof DutyRosterRow>;
function dutyWho(
  c: { person_id?: string | null | undefined; person_name?: string | null | undefined },
  ctx: z.core.$RefinementCtx,
) {
  if (c.person_id == null && !c.person_name?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['person_name'],
      message: 'a person or a name is required',
    });
  }
}
/** person_name is ignored by the server when person_id is set. */
export const DutyCellInput = z
  .object({
    date: IsoDate,
    role: DutyRole,
    slot: DutySlot,
    person_id: z.nullable(Uuid),
    person_name: DutyPersonName,
    note: z.optional(DutyNote),
  })
  .check(z.superRefine(dutyWho));
export type DutyCellInput = z.infer<typeof DutyCellInput>;

export const DutyDayKind = z.enum(['normal', 'asamblea', 'sin_reunion']);
export type DutyDayKind = z.infer<typeof DutyDayKind>;
const DutyDayNote = z.nullable(z.string().check(z.maxLength(200)));
export const DutyDayRow = z.object({
  date: IsoDate,
  kind: DutyDayKind,
  note: DutyDayNote,
  ...Meta,
});
export type DutyDayRow = z.infer<typeof DutyDayRow>;
export const DutyDayInput = z.object({
  date: IsoDate,
  kind: DutyDayKind,
  note: z.optional(DutyDayNote),
});
export type DutyDayInput = z.infer<typeof DutyDayInput>;

// ---------------------------------------------------------------------------
// device_tokens (own rows only)
// ---------------------------------------------------------------------------
export const DevicePlatform = z.enum(['ios', 'android', 'web']);
export const DeviceTokenRow = z.object({
  id: Uuid,
  user_id: Uuid,
  token: z.string().check(z.minLength(10), z.maxLength(4096)),
  platform: DevicePlatform,
  ...Meta,
});
export type DeviceTokenRow = z.infer<typeof DeviceTokenRow>;
export const DeviceTokenInsert = z.pick(DeviceTokenRow, { token: true, platform: true });
export type DeviceTokenInsert = z.infer<typeof DeviceTokenInsert>;

// ---------------------------------------------------------------------------
// Account RPCs (docs/ASSIGNMENTS.md): rows returned by my_assignments / my_link / list_accounts
// ---------------------------------------------------------------------------
export const AssignmentKind = z.enum(['carrito', 'programa', 'salida', 'privilegio']);
export type AssignmentKind = z.infer<typeof AssignmentKind>;

export const MyAssignment = z.object({
  /**
   * Stable id: carrito:<assignment id>:<date> | programa:<kind>:<date>:<index or field> |
   * salida:<meeting id> | privilegio:<date>:<role>:<slot>.
   */
  key: z.string().check(z.minLength(1)),
  kind: AssignmentKind,
  date: IsoDate,
  /** "HH:MM", or null (e.g. a weekend program role, a privilegio). */
  start_time: z.nullable(z.string()),
  title: z.string(),
  place: z.nullable(z.string()),
  /** e.g. "Lector", "Conductor"; null for carrito. */
  role: z.nullable(z.string()),
  /** Carrito: the other people + note. Salida: groups. */
  detail: z.nullable(z.string()),
});
export type MyAssignment = z.infer<typeof MyAssignment>;

export const MyLink = z.object({ person_id: Uuid, person_name: z.string() });
export type MyLink = z.infer<typeof MyLink>;

export type AccountRole = Role;
export const AccountRow = z.object({
  user_id: Uuid,
  email: z.nullable(z.string()),
  display_name: z.nullable(z.string()),
  avatar_url: z.nullable(z.string()),
  provider: z.nullable(z.string()),
  role: Role,
  person_id: z.nullable(Uuid),
  person_name: z.nullable(z.string()),
  created_at: Timestamp,
  /** Stored grants (the admin toggles); editors/admins can edit both meetings regardless. */
  can_edit_programa_midweek: z.boolean(),
  can_edit_programa_weekend: z.boolean(),
  can_edit_privilegios: z.boolean(),
});
export type AccountRow = z.infer<typeof AccountRow>;

/** public.my_permissions(): the caller's role and EFFECTIVE permissions (true for editors/admins). */
export const MyPermissions = z.object({
  role: Role,
  /** Effective grants: editors/admins get both program meetings. */
  can_edit_programa_midweek: z.boolean(),
  can_edit_programa_weekend: z.boolean(),
  can_edit_privilegios: z.boolean(),
  /** Show the Privilegios route: editor/admin, can_edit_privilegios or linked person has a duty. */
  sees_privilegios: z.boolean(),
});
export type MyPermissions = z.infer<typeof MyPermissions>;

// ---------------------------------------------------------------------------
// People directory RPCs (docs/PRIVILEGIOS.md)
// ---------------------------------------------------------------------------
export const NameSourceKind = z.enum(['programa', 'salida', 'privilegio']);
export type NameSourceKind = z.infer<typeof NameSourceKind>;
/** public.name_sources(): one distinct (normalised) name, unmatched first. Editor only. */
export const NameSource = z.object({
  /** Most common spelling (whitespace collapsed). */
  name: z.string(),
  /** private.norm_name(name): lower, unaccented, single spaces. */
  norm: z.string(),
  sources: z.array(NameSourceKind),
  uses: z.int().check(z.minimum(1)),
  first_date: z.nullable(IsoDate),
  last_date: z.nullable(IsoDate),
  /** The person it matches by name or alias; null = "Nombres sin vincular". */
  person_id: z.nullable(Uuid),
  person_name: z.nullable(z.string()),
});
export type NameSource = z.infer<typeof NameSource>;

/** public.duty_people(): roster pickers for editors and can_edit_privilegios users. */
export const DutyPerson = z.object({
  id: Uuid,
  name: z.string(),
  duties: z.array(DutyRole),
  aliases: z.array(z.string()),
});
export type DutyPerson = z.infer<typeof DutyPerson>;

/**
 * public.people_directory(): everyone, for the schedule person pickers. Editors, either program
 * grant (midweek or weekend) and can_edit_privilegios (who cannot read `people` directly).
 */
export const DirectoryPerson = z.object({
  id: Uuid,
  name: z.string(),
  aliases: z.array(z.string()),
  duties: z.array(DutyRole),
  in_carrito: z.boolean(),
});
export type DirectoryPerson = z.infer<typeof DirectoryPerson>;

// ---------------------------------------------------------------------------
// Table registry
// ---------------------------------------------------------------------------
export const rowSchemas = {
  profiles: ProfileRow,
  territories: TerritoryRow,
  service_weeks: ServiceWeekRow,
  service_meetings: ServiceMeetingRow,
  cart_places: CartPlaceRow,
  cart_slots: CartSlotRow,
  people: PersonRow,
  person_availability: PersonAvailabilityRow,
  person_pairs: PersonPairRow,
  cart_schedules: CartScheduleRow,
  cart_assignments: CartAssignmentRow,
  cart_blackouts: CartBlackoutRow,
  program_weeks: ProgramWeekRow,
  device_tokens: DeviceTokenRow,
  duty_roster: DutyRosterRow,
  duty_days: DutyDayRow,
} as const;
export type TableName = keyof typeof rowSchemas;
export type RowOf<T extends TableName> = z.infer<(typeof rowSchemas)[T]>;
