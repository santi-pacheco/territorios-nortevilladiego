/**
 * Pure v1 → v2 conversion. No network, no randomness: every id is a v5 uuid of a v1 key,
 * and every match key is built from v1 data (never from ids core mints during migration).
 */
import { migrateSchedule, salidasToScheduleData, kindForDow } from '@territorios/core';
import type { DayEntry, DomingoSlot, SalidaSlot } from '@territorios/core';
import type {
  CartAssignmentRow,
  CartBlackoutRow,
  CartPlaceRow,
  CartScheduleRow,
  CartSlotRow,
  Desired,
  PersonAvailabilityRow,
  PersonPairRow,
  PersonRow,
  ProgramWeekRow,
  Report,
  ServiceMeetingRow,
  ServiceWeekRow,
  TerritoryRow,
  V1Snapshot,
} from './types';
import { addDaysIso, daysBetween, isIsoDate, isoDow, isRecord, normalizeTime, str, uuidV5 } from './util';

export function emptyDesired(): Desired {
  return {
    territories: [],
    service_weeks: [],
    service_meetings: [],
    cart_places: [],
    cart_slots: [],
    people: [],
    person_availability: [],
    person_pairs: [],
    cart_schedules: [],
    cart_assignments: [],
    cart_blackouts: [],
    program_weeks: [],
  };
}

export function convert(snapshot: V1Snapshot, territories: TerritoryRow[], report: Report): Desired {
  const out = emptyDesired();
  out.territories = territories;
  convertSalidas(snapshot.salidas, out, report);
  convertCarrito(snapshot.carrito, out, report);
  convertPrograma(snapshot.programa, out, report);

  const known = new Set(territories.map((t) => t.id));
  for (const m of out.service_meetings) {
    const ids = [...m.territory_ids, ...Object.values(m.group_territories).flat()];
    for (const id of ids) if (!known.has(id)) report.warn('salidas: territory id not in KML (kept)', `dow ${m.dow} #${m.position}: ${id}`);
  }
  return out;
}

function clamp(value: string, max: number, report: Report, what: string): string {
  if (value.length <= max) return value;
  report.warn(`${what}: truncated to ${max} chars`, value.slice(0, 40));
  return value.slice(0, max);
}

// --- Salidas -------------------------------------------------------------------

// Same tokenizer as core salidasAdapter (private there): "5, 12" / "5-12" / "5 y 12".
function parseIdList(raw: string): number[] {
  const parts = raw.split(/[-,/]|\s+y\s+|\s+&\s+|\s+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts.filter((p) => /^\d+$/.test(p)).map(Number))].filter((n) => n > 0);
}

/** Raw Domingo slots in stored order, read BEFORE migrateSchedule folds g1..g4 into `grupos`. */
function rawDomingoSlots(raw: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(raw.days)) {
    return raw.days
      .filter((d): d is Record<string, unknown> => isRecord(d) && d.kind === 'domingo' && Array.isArray(d.domingoSlots))
      .flatMap((d) => (d.domingoSlots as unknown[]).map((s) => (isRecord(s) ? s : {})));
  }
  return Array.isArray(raw.domingo) ? raw.domingo.map((s) => (isRecord(s) ? s : {})) : [];
}

function legacyGroupTerritories(slot: Record<string, unknown> | undefined): ServiceMeetingRow['group_territories'] {
  const out: ServiceMeetingRow['group_territories'] = {};
  if (!slot) return out;
  for (const n of [1, 2, 3, 4] as const) {
    const ids = parseIdList(str(slot[`g${n}`]));
    if (ids.length) out[`G${n}`] = ids;
  }
  return out;
}

/**
 * Territory ids of one slot, parsed by core's own adapter. The slot is run through
 * salidasToScheduleData alone, so missing/duplicate v1 slot ids can't cross-wire results.
 */
function coreTerritoryIds(day: DayEntry, slot: SalidaSlot | DomingoSlot): number[] {
  const single: DayEntry =
    day.kind === 'domingo'
      ? { ...day, slots: [], domingoSlots: [slot as DomingoSlot] }
      : { ...day, slots: [slot as SalidaSlot], domingoSlots: [] };
  const adapted = salidasToScheduleData({ mes: '', weekStart: '', days: [single] });
  return adapted.days[0]?.assignments[0]?.territoryIds ?? [];
}

function convertSalidas(raw: unknown, out: Desired, report: Report): void {
  if (!isRecord(raw) || !(Array.isArray(raw.days) || Array.isArray(raw.miercoles) || Array.isArray(raw.domingo))) {
    report.warn('salidas: no schedule in v1 row (skipped)', 'salidas.data');
    return;
  }
  const schedule = migrateSchedule(raw);
  const ws = schedule.weekStart ?? '';
  if (!isIsoDate(ws)) {
    report.warn('salidas: weekStart missing/invalid, week skipped', JSON.stringify(ws));
    return;
  }
  const dow = isoDow(ws);
  if (dow !== 3) report.warn('salidas: weekStart is not a Wednesday (used Monday of its week)', ws);
  const monday = addDaysIso(ws, -(dow - 1)); // == weekStart - 2 days for the usual Wednesday

  const week: ServiceWeekRow = {
    id: uuidV5(`week:${monday}`),
    week_start: monday,
    month_label: clamp(schedule.mes, 40, report, 'salidas: mes'),
  };
  out.service_weeks.push(week);

  const rawDom = rawDomingoSlots(raw);
  let domIndex = 0;
  const nextPos = new Map<number, number>();

  schedule.days.forEach((day) => {
    const dayDow = Number(day.dow);
    if (!Number.isInteger(dayDow) || dayDow < 0 || dayDow > 6) {
      report.warn('salidas: day with invalid dow (skipped)', String(day.dow));
      return;
    }
    const kind = kindForDow(dayDow);
    if (day.kind !== kind) report.warn('salidas: day kind fixed from dow', `dow ${dayDow} was ${day.kind}`);

    const slots =
      day.kind === 'domingo'
        ? (day.domingoSlots ?? []).map((s) => {
            const rawSlot = rawDom[domIndex++];
            return { ...s, groupTerritories: legacyGroupTerritories(rawSlot) };
          })
        : (day.slots ?? []).map((s) => ({ ...s, groupTerritories: {} }));

    for (const s of slots) {
      const position = nextPos.get(dayDow) ?? 0;
      nextPos.set(dayDow, position + 1);
      if (position > 99) {
        report.warn('salidas: more than 100 slots in a day (skipped)', `dow ${dayDow}`);
        continue;
      }
      let territoryIds = coreTerritoryIds(day, s);
      if (territoryIds.length > 60) {
        report.warn('salidas: territory list cut to 60', `dow ${dayDow} #${position}`);
        territoryIds = territoryIds.slice(0, 60);
      }
      out.service_meetings.push({
        id: uuidV5(`meeting:${monday}:${dayDow}:${position}`),
        week_id: week.id,
        dow: dayDow,
        position,
        kind,
        start_time: clamp(str(s.hora), 20, report, 'salidas: hora'),
        groups: clamp(str(s.grupos), 120, report, 'salidas: grupos'),
        conductor: clamp(str(s.conductor), 120, report, 'salidas: conductor'),
        place: clamp(str(s.lugar), 200, report, 'salidas: lugar'),
        territory_ids: territoryIds,
        group_territories: kind === 'domingo' ? s.groupTerritories : {},
      });
    }
  });
}

// --- Carrito -------------------------------------------------------------------

function convertCarrito(raw: unknown, out: Desired, report: Report): void {
  if (!isRecord(raw) || !Array.isArray(raw.places) || !Array.isArray(raw.slots) || !Array.isArray(raw.people)) {
    report.warn('carrito: no data in v1 row (skipped)', 'carrito.data');
    return;
  }

  const placeIds = new Map<string, string>();
  for (const p of raw.places) {
    if (!isRecord(p) || typeof p.id !== 'string' || !p.id) {
      report.warn('carrito: place without id (skipped)', JSON.stringify(p).slice(0, 60));
      continue;
    }
    if (placeIds.has(p.id)) {
      report.warn('carrito: duplicate place id (kept first)', p.id);
      continue;
    }
    const name = str(p.name).trim();
    if (!name) {
      report.warn('carrito: place without name (skipped)', p.id);
      continue;
    }
    let color = str(p.color);
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      report.warn('carrito: invalid place color → #888888', `${p.id}: ${color}`);
      color = '#888888';
    }
    const row: CartPlaceRow = { id: uuidV5(`place:${p.id}`), name: clamp(name, 120, report, 'carrito: place name'), color };
    placeIds.set(p.id, row.id);
    out.cart_places.push(row);
  }

  const slotIds = new Map<string, string>();
  for (const s of raw.slots) {
    if (!isRecord(s) || typeof s.id !== 'string' || !s.id) {
      report.warn('carrito: slot without id (skipped)', JSON.stringify(s).slice(0, 60));
      continue;
    }
    if (slotIds.has(s.id)) {
      report.warn('carrito: duplicate slot id (kept first)', s.id);
      continue;
    }
    const placeId = placeIds.get(str(s.placeId));
    const day = Number(s.dayOfWeek);
    const start = normalizeTime(s.startTime);
    const end = normalizeTime(s.endTime);
    if (!placeId) {
      report.warn('carrito: slot with unknown place (skipped)', s.id);
      continue;
    }
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      report.warn('carrito: slot with invalid dayOfWeek (skipped)', `${s.id}: ${String(s.dayOfWeek)}`);
      continue;
    }
    if (!start || !end || end <= start) {
      report.warn('carrito: slot with invalid times (skipped)', `${s.id}: ${String(s.startTime)}-${String(s.endTime)}`);
      continue;
    }
    let size = Math.round(Number(s.groupSize));
    if (!Number.isFinite(size) || size < 1 || size > 12) {
      const fixed = Number.isFinite(size) ? Math.min(12, Math.max(1, size)) : 2;
      report.warn('carrito: groupSize clamped to 1..12', `${s.id}: ${String(s.groupSize)} → ${fixed}`);
      size = fixed;
    }
    const label = str(s.displayLabel).trim();
    const row: CartSlotRow = {
      id: uuidV5(`slot:${s.id}`),
      place_id: placeId,
      iso_dow: day,
      start_time: start,
      end_time: end,
      group_size: size,
      display_label: label ? clamp(label, 80, report, 'carrito: displayLabel') : null,
    };
    slotIds.set(s.id, row.id);
    out.cart_slots.push(row);
  }

  const personIds = new Map<string, string>();
  const rawPeople: Record<string, unknown>[] = [];
  for (const p of raw.people) {
    if (!isRecord(p) || typeof p.id !== 'string' || !p.id) {
      report.warn('carrito: person without id (skipped)', '(no id)');
      continue;
    }
    if (personIds.has(p.id)) {
      report.warn('carrito: duplicate person id (kept first)', p.id);
      continue;
    }
    const name = str(p.name).trim();
    if (!name) {
      report.warn('carrito: person without name (skipped)', p.id);
      continue;
    }
    if (p.gender !== 'M' && p.gender !== 'F') {
      report.warn('carrito: person with invalid gender (skipped)', `${p.id}: ${String(p.gender)}`);
      continue;
    }
    let target = Math.round(Number(p.targetAppearances));
    if (!Number.isFinite(target)) target = 0;
    if (target < 0 || target > 999) {
      const fixed = Math.min(999, Math.max(0, target));
      report.warn('carrito: targetAppearances clamped to 0..999', `${p.id}: ${target} → ${fixed}`);
      target = fixed;
    }
    const row: PersonRow = {
      id: uuidV5(`person:${p.id}`),
      name: clamp(name, 120, report, 'carrito: person name'),
      gender: p.gender,
      target_appearances: target,
    };
    personIds.set(p.id, row.id);
    rawPeople.push(p);
    out.people.push(row);
  }

  const pairKeys = new Set<string>();
  for (const p of rawPeople) {
    const pid = personIds.get(p.id as string)!;
    const avail = new Set<string>();
    for (const sid of Array.isArray(p.availableSlotIds) ? p.availableSlotIds : []) {
      const slot = slotIds.get(str(sid));
      if (!slot) {
        report.warn('carrito: availability for unknown slot (skipped)', `${String(p.id)} → ${String(sid)}`);
        continue;
      }
      if (avail.has(slot)) continue;
      avail.add(slot);
      out.person_availability.push({ person_id: pid, slot_id: slot } satisfies PersonAvailabilityRow);
    }
    for (const oid of Array.isArray(p.mustBeWithIds) ? p.mustBeWithIds : []) {
      const other = personIds.get(str(oid));
      if (!other) {
        report.warn('carrito: mustBeWith unknown person (skipped)', `${String(p.id)} → ${String(oid)}`);
        continue;
      }
      if (other === pid) {
        report.warn('carrito: mustBeWith self (skipped)', String(p.id));
        continue;
      }
      // uuid ordering in Postgres is bytewise == lowercase hex string ordering.
      const [a, b] = pid < other ? [pid, other] : [other, pid];
      const key = `${a}|${b}`;
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      out.person_pairs.push({ person_a: a, person_b: b } satisfies PersonPairRow);
    }
  }

  convertCarritoSchedule(raw.schedule, slotIds, personIds, out, report);

  const blackoutKeys = new Set<string>();
  for (const b of Array.isArray(raw.blackouts) ? raw.blackouts : []) {
    if (!isRecord(b)) continue;
    const slot = slotIds.get(str(b.slotId));
    if (!slot || !isIsoDate(b.date)) {
      report.warn('carrito: blackout with unknown slot or bad date (skipped)', `${str(b.slotId)} ${String(b.date)}`);
      continue;
    }
    const key = `${slot}|${b.date}`;
    if (blackoutKeys.has(key)) {
      report.warn('carrito: duplicate blackout (kept first)', `${str(b.slotId)} ${b.date}`);
      continue;
    }
    blackoutKeys.add(key);
    out.cart_blackouts.push({ id: uuidV5(`blackout:${str(b.slotId)}:${b.date}`), slot_id: slot, date: b.date } satisfies CartBlackoutRow);
  }
}

function convertCarritoSchedule(
  raw: unknown,
  slotIds: Map<string, string>,
  personIds: Map<string, string>,
  out: Desired,
  report: Report,
): void {
  if (raw == null) return;
  if (!isRecord(raw) || !isIsoDate(raw.startDate) || !isIsoDate(raw.endDate)) {
    report.warn('carrito: schedule without valid start/end dates (skipped)', 'schedule');
    return;
  }
  const span = daysBetween(raw.startDate, raw.endDate);
  if (span < 0 || span > 400) {
    report.warn('carrito: schedule range invalid or > 400 days (skipped)', `${raw.startDate}..${raw.endDate}`);
    return;
  }
  const schedule: CartScheduleRow = {
    id: uuidV5('schedule:v1'),
    name: clamp(str(raw.name), 120, report, 'carrito: schedule name'),
    start_date: raw.startDate,
    end_date: raw.endDate,
  };
  out.cart_schedules.push(schedule);

  const cells = new Set<string>();
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isRecord(e)) continue;
    const slot = slotIds.get(str(e.slotId));
    const where = `${String(e.weekDate)} ${str(e.slotId)}`;
    if (!slot) {
      report.warn('carrito: assignment for unknown slot (skipped)', where);
      continue;
    }
    if (!isIsoDate(e.weekDate) || isoDow(e.weekDate) !== 1) {
      report.warn('carrito: assignment weekDate not a Monday (skipped)', where);
      continue;
    }
    const key = `${e.weekDate}|${slot}`;
    if (cells.has(key)) {
      report.warn('carrito: duplicate assignment cell (kept first)', where);
      continue;
    }
    cells.add(key);
    const ids: string[] = [];
    for (const pid of Array.isArray(e.personIds) ? e.personIds : []) {
      const id = personIds.get(str(pid));
      if (!id) report.warn('carrito: assignment person unknown (dropped from cell)', `${where} → ${String(pid)}`);
      else if (ids.includes(id)) report.warn('carrito: assignment person repeated (deduped)', `${where} → ${String(pid)}`);
      else ids.push(id);
    }
    if (ids.length > 12) {
      report.warn('carrito: assignment cut to 12 people', where);
      ids.length = 12;
    }
    const note = str(e.note);
    out.cart_assignments.push({
      id: uuidV5(`assignment:${e.weekDate}:${str(e.slotId)}`),
      schedule_id: schedule.id,
      slot_id: slot,
      week_date: e.weekDate,
      person_ids: ids,
      note: note ? clamp(note, 500, report, 'carrito: note') : null,
    } satisfies CartAssignmentRow);
  }
}

// --- Programa ------------------------------------------------------------------

const PROGRAM_KINDS = [
  { key: 'midweek', kind: 'midweek', dow: 2, day: 'Tuesday' },
  { key: 'weekend', kind: 'weekend', dow: 6, day: 'Saturday' },
] as const;

function convertPrograma(raw: unknown, out: Desired, report: Report): void {
  if (!isRecord(raw) || !isRecord(raw.midweek) || !isRecord(raw.weekend)) {
    report.warn('programa: no data in v1 row (skipped)', 'programa.data');
    return;
  }
  for (const { key, kind, dow, day } of PROGRAM_KINDS) {
    const entries = raw[key] as Record<string, unknown>;
    for (const date of Object.keys(entries).sort()) {
      const data = entries[date];
      if (!isIsoDate(date) || isoDow(date) !== dow) {
        report.warn(`programa: ${kind} key not a ${day} (skipped)`, date);
        continue;
      }
      if (!isRecord(data)) {
        report.warn(`programa: ${kind} entry is not an object (skipped)`, date);
        continue;
      }
      if (Buffer.byteLength(JSON.stringify(data)) > 60_000) {
        report.warn(`programa: ${kind} entry over size limit (skipped)`, date);
        continue;
      }
      out.program_weeks.push({ id: uuidV5(`program:${kind}:${date}`), kind, date, data } satisfies ProgramWeekRow);
    }
  }
}
