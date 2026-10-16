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
import { z } from 'zod';

/** Bump when a row shape changes: busts the persisted query cache. */
export const SCHEMA_VERSION = '2026-10-16.1';

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
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM[:SS]');

/** ISO day of week (1 = Monday … 7 = Sunday) for a YYYY-MM-DD string. */
export function isoDow(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const isMonday = (d: string) => isoDow(d) === 1;

const Meta = {
  updated_at: Timestamp,
  version: z.number().int().min(1),
  updated_by: Uuid.nullable(),
};

/** Columns the client must never send. */
const SERVER_OWNED = { updated_at: true, version: true, updated_by: true } as const;

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
export const Role = z.enum(['viewer', 'editor', 'admin']);
export type Role = z.infer<typeof Role>;

const DisplayName = z.string().min(1).max(80).nullable();

export const ProfileRow = z.object({
  id: Uuid,
  role: Role,
  display_name: DisplayName,
  ...Meta,
});
export type ProfileRow = z.infer<typeof ProfileRow>;
/** Only `display_name` has a column grant for authenticated users. */
export const ProfileUpdate = z.object({ display_name: DisplayName });
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

// ---------------------------------------------------------------------------
// territories
// ---------------------------------------------------------------------------
const Position = z.array(z.number()).min(2);
const Ring = z.array(Position);
export const TerritoryGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring)) }),
]);
export type TerritoryGeometry = z.infer<typeof TerritoryGeometry>;

export const TerritoryRow = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  geometry: TerritoryGeometry,
  centroid_lng: z.number().min(-180).max(180),
  centroid_lat: z.number().min(-90).max(90),
  ...Meta,
});
export type TerritoryRow = z.infer<typeof TerritoryRow>;
export const TerritoryInsert = TerritoryRow.omit(SERVER_OWNED);
export type TerritoryInsert = z.infer<typeof TerritoryInsert>;
export const TerritoryUpdate = TerritoryInsert.omit({ id: true }).partial();
export type TerritoryUpdate = z.infer<typeof TerritoryUpdate>;

// ---------------------------------------------------------------------------
// service_weeks / service_meetings (Salidas)
// ---------------------------------------------------------------------------
export const ServiceWeekRow = z.object({
  id: Uuid,
  week_start: IsoDate.refine(isMonday, 'week_start must be a Monday'),
  month_label: z.string().max(40),
  ...Meta,
});
export type ServiceWeekRow = z.infer<typeof ServiceWeekRow>;
export const ServiceWeekInsert = ServiceWeekRow.omit(SERVER_OWNED).extend({
  id: Uuid.optional(),
  month_label: z.string().max(40).optional(),
});
export type ServiceWeekInsert = z.infer<typeof ServiceWeekInsert>;
export const ServiceWeekUpdate = ServiceWeekRow.pick({
  week_start: true,
  month_label: true,
}).partial();
export type ServiceWeekUpdate = z.infer<typeof ServiceWeekUpdate>;

export const MeetingKind = z.enum(['normal', 'domingo']);
export type MeetingKind = z.infer<typeof MeetingKind>;
const TerritoryIds = z.array(z.number().int()).max(60);
/** Domingo-only per-group layout: keys G1..G4 only. */
export const GroupTerritories = z.strictObject({
  G1: z.array(z.number().int()).optional(),
  G2: z.array(z.number().int()).optional(),
  G3: z.array(z.number().int()).optional(),
  G4: z.array(z.number().int()).optional(),
});
export type GroupTerritories = z.infer<typeof GroupTerritories>;

const meetingFields = {
  id: Uuid,
  week_id: Uuid,
  /** JS numbering: 0 = Domingo … 6 = Sábado. */
  dow: z.number().int().min(0).max(6),
  position: z.number().int().min(0).max(99),
  kind: MeetingKind,
  start_time: z.string().max(20),
  groups: z.string().max(120),
  conductor: z.string().max(120),
  place: z.string().max(200),
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
  ctx: z.RefinementCtx,
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
  .superRefine(meetingInvariants);
export type ServiceMeetingRow = z.infer<typeof ServiceMeetingRow>;
export const ServiceMeetingInsert = z
  .object({
    ...meetingFields,
    id: Uuid.optional(),
    position: meetingFields.position.optional(),
    kind: MeetingKind.optional(),
    start_time: meetingFields.start_time.optional(),
    groups: meetingFields.groups.optional(),
    conductor: meetingFields.conductor.optional(),
    place: meetingFields.place.optional(),
    territory_ids: TerritoryIds.optional(),
    group_territories: GroupTerritories.optional(),
  })
  .superRefine(meetingInvariants);
export type ServiceMeetingInsert = z.infer<typeof ServiceMeetingInsert>;
export const ServiceMeetingUpdate = z
  .object(meetingFields)
  .omit({ id: true, week_id: true })
  .partial()
  .superRefine(meetingInvariants);
export type ServiceMeetingUpdate = z.infer<typeof ServiceMeetingUpdate>;

// ---------------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------------
const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const CartPlaceRow = z.object({
  id: Uuid,
  name: z.string().min(1).max(120),
  color: HexColor,
  ...Meta,
});
export type CartPlaceRow = z.infer<typeof CartPlaceRow>;
export const CartPlaceInsert = z.object({
  id: Uuid.optional(),
  name: z.string().min(1).max(120),
  color: HexColor.optional(),
});
export type CartPlaceInsert = z.infer<typeof CartPlaceInsert>;
export const CartPlaceUpdate = CartPlaceInsert.omit({ id: true }).partial();
export type CartPlaceUpdate = z.infer<typeof CartPlaceUpdate>;

/** Compare HH:MM[:SS] strings (lexicographic works after padding seconds). */
const toSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);
function slotTimeOrder(
  s: { start_time?: string | undefined; end_time?: string | undefined },
  ctx: z.RefinementCtx,
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
  iso_dow: z.number().int().min(1).max(7),
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  group_size: z.number().int().min(1).max(12),
  display_label: z.string().max(80).nullable(),
};
export const CartSlotRow = z.object({ ...slotFields, ...Meta }).superRefine(slotTimeOrder);
export type CartSlotRow = z.infer<typeof CartSlotRow>;
export const CartSlotInsert = z
  .object({
    ...slotFields,
    id: Uuid.optional(),
    group_size: slotFields.group_size.optional(),
    display_label: slotFields.display_label.optional(),
  })
  .superRefine(slotTimeOrder);
export type CartSlotInsert = z.infer<typeof CartSlotInsert>;
export const CartSlotUpdate = z
  .object(slotFields)
  .omit({ id: true })
  .partial()
  .superRefine(slotTimeOrder);
export type CartSlotUpdate = z.infer<typeof CartSlotUpdate>;

function scheduleRange(
  s: { start_date?: string | undefined; end_date?: string | undefined },
  ctx: z.RefinementCtx,
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
  name: z.string().max(120),
  start_date: IsoDate,
  end_date: IsoDate,
};
export const CartScheduleRow = z.object({ ...scheduleFields, ...Meta }).superRefine(scheduleRange);
export type CartScheduleRow = z.infer<typeof CartScheduleRow>;
export const CartScheduleInsert = z
  .object({ ...scheduleFields, id: Uuid.optional(), name: scheduleFields.name.optional() })
  .superRefine(scheduleRange);
export type CartScheduleInsert = z.infer<typeof CartScheduleInsert>;
export const CartScheduleUpdate = z
  .object(scheduleFields)
  .omit({ id: true })
  .partial()
  .superRefine(scheduleRange);
export type CartScheduleUpdate = z.infer<typeof CartScheduleUpdate>;

function uniquePeople(a: { person_ids?: string[] | undefined }, ctx: z.RefinementCtx) {
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
  week_date: IsoDate.refine(isMonday, 'week_date must be a Monday'),
  person_ids: z.array(Uuid).max(12),
  note: z.string().max(500).nullable(),
};
export const CartAssignmentRow = z
  .object({
    ...assignmentFields,
    /** Trigger-maintained snapshot of people.name (public). Never sent by the client. */
    person_names: z.array(z.string()),
    ...Meta,
  })
  .superRefine(uniquePeople)
  .refine((a) => a.person_names.length === a.person_ids.length, {
    path: ['person_names'],
    message: 'person_names must match person_ids',
  });
export type CartAssignmentRow = z.infer<typeof CartAssignmentRow>;
export const CartAssignmentInsert = z
  .object({
    ...assignmentFields,
    id: Uuid.optional(),
    person_ids: assignmentFields.person_ids.optional(),
    note: assignmentFields.note.optional(),
  })
  .superRefine(uniquePeople);
export type CartAssignmentInsert = z.infer<typeof CartAssignmentInsert>;
export const CartAssignmentUpdate = z
  .object({ person_ids: assignmentFields.person_ids, note: assignmentFields.note })
  .partial()
  .superRefine(uniquePeople);
export type CartAssignmentUpdate = z.infer<typeof CartAssignmentUpdate>;

export const CartBlackoutRow = z.object({ id: Uuid, slot_id: Uuid, date: IsoDate, ...Meta });
export type CartBlackoutRow = z.infer<typeof CartBlackoutRow>;
export const CartBlackoutInsert = z.object({ id: Uuid.optional(), slot_id: Uuid, date: IsoDate });
export type CartBlackoutInsert = z.infer<typeof CartBlackoutInsert>;

// ---------------------------------------------------------------------------
// People (editor/admin only — PII)
// ---------------------------------------------------------------------------
export const Gender = z.enum(['M', 'F']);
export type Gender = z.infer<typeof Gender>;
const personFields = {
  id: Uuid,
  name: z.string().min(1).max(120),
  gender: Gender,
  /** 0 = unlimited. */
  target_appearances: z.number().int().min(0).max(999),
};
export const PersonRow = z.object({ ...personFields, ...Meta });
export type PersonRow = z.infer<typeof PersonRow>;
export const PersonInsert = z.object({
  ...personFields,
  id: Uuid.optional(),
  target_appearances: personFields.target_appearances.optional(),
});
export type PersonInsert = z.infer<typeof PersonInsert>;
export const PersonUpdate = PersonInsert.omit({ id: true }).partial();
export type PersonUpdate = z.infer<typeof PersonUpdate>;

export const PersonAvailabilityRow = z.object({ person_id: Uuid, slot_id: Uuid, ...Meta });
export type PersonAvailabilityRow = z.infer<typeof PersonAvailabilityRow>;
export const PersonAvailabilityInsert = PersonAvailabilityRow.omit(SERVER_OWNED);
export type PersonAvailabilityInsert = z.infer<typeof PersonAvailabilityInsert>;

/** Stored once with person_a < person_b; a trigger reorders inserts, so either order may be sent. */
export const PersonPairRow = z
  .object({ person_a: Uuid, person_b: Uuid, ...Meta })
  .refine((p) => p.person_a < p.person_b, {
    path: ['person_b'],
    message: 'person_a must sort before person_b',
  });
export type PersonPairRow = z.infer<typeof PersonPairRow>;
export const PersonPairInsert = z
  .object({ person_a: Uuid, person_b: Uuid })
  .refine((p) => p.person_a !== p.person_b, {
    path: ['person_b'],
    message: 'a person cannot pair with themselves',
  });
export type PersonPairInsert = z.infer<typeof PersonPairInsert>;

// ---------------------------------------------------------------------------
// program_weeks
// ---------------------------------------------------------------------------
export const ProgramKind = z.enum(['midweek', 'weekend']);
export type ProgramKind = z.infer<typeof ProgramKind>;
/** Shape validated by packages/core (MidweekWeek / WeekendMeeting); here: any JSON object. */
export const ProgramData = z.record(z.string(), z.unknown());
export type ProgramData = z.infer<typeof ProgramData>;

function programKeyDay(
  p: { kind?: ProgramKind | undefined; date?: string | undefined },
  ctx: z.RefinementCtx,
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
export const ProgramWeekRow = z.object({ ...programFields, ...Meta }).superRefine(programKeyDay);
export type ProgramWeekRow = z.infer<typeof ProgramWeekRow>;
export const ProgramWeekInsert = z
  .object({ ...programFields, id: Uuid.optional(), data: ProgramData.optional() })
  .superRefine(programKeyDay);
export type ProgramWeekInsert = z.infer<typeof ProgramWeekInsert>;
/** kind/date form the natural key; only `data` is patched. */
export const ProgramWeekUpdate = z.object({ data: ProgramData });
export type ProgramWeekUpdate = z.infer<typeof ProgramWeekUpdate>;

// ---------------------------------------------------------------------------
// device_tokens (own rows only)
// ---------------------------------------------------------------------------
export const DevicePlatform = z.enum(['ios', 'android', 'web']);
export const DeviceTokenRow = z.object({
  id: Uuid,
  user_id: Uuid,
  token: z.string().min(10).max(4096),
  platform: DevicePlatform,
  ...Meta,
});
export type DeviceTokenRow = z.infer<typeof DeviceTokenRow>;
export const DeviceTokenInsert = DeviceTokenRow.pick({ token: true, platform: true });
export type DeviceTokenInsert = z.infer<typeof DeviceTokenInsert>;

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
} as const;
export type TableName = keyof typeof rowSchemas;
export type RowOf<T extends TableName> = z.infer<(typeof rowSchemas)[T]>;
