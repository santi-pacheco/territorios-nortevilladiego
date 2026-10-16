import type { Person, TimeSlot, ScheduleConfig, ScheduleEntry, SlotBlackout, Place } from './types';
import { CARRITO_DAY_NAMES } from './days';

export interface ScheduleResult {
  config: ScheduleConfig;
  warnings: string[];
}

/** Optional knobs for {@link generateSchedule}. */
export interface GenerateScheduleOptions {
  /**
   * Deterministic PRNG seed. The same seed always produces the same output.
   * Omit to draw a fresh random seed on each call.
   */
  seed?: number;
  /** Places, used only to render readable warnings (e.g. "Jueves 08:30, Lugar Uno"). */
  places?: Place[];
}

/**
 * Small deterministic PRNG (mulberry32). Replaces `Math.random` so a schedule
 * can be reproduced exactly from a numeric seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseLocalDate(iso: string): Date {
  const [y = NaN, m = NaN, d = NaN] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toISOLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + offset);
  return monday;
}

function getOverlappingWeeks(start: Date, end: Date): Date[] {
  const firstMonday = getMondayOfWeek(start);
  const weeks: Date[] = [];
  const cur = new Date(firstMonday);
  while (cur <= end) {
    weeks.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return weeks;
}

function getSlotDate(monday: Date, dayOfWeek: number): Date {
  const d = new Date(monday);
  d.setDate(monday.getDate() + (dayOfWeek - 1));
  return d;
}

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatWeekLabel(d: Date): string {
  return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
}

/** Human-readable slot header: "Jueves 08:30, Lugar Uno". */
function buildSlotLabel(slot: TimeSlot, placeName: (placeId: string) => string | undefined): string {
  if (slot.displayLabel) return slot.displayLabel;
  const day = CARRITO_DAY_NAMES[slot.dayOfWeek] ?? `Día ${slot.dayOfWeek}`;
  const place = placeName(slot.placeId) ?? slot.placeId;
  return `${day} ${slot.startTime}, ${place}`;
}

interface Unit {
  members: Person[];
}

function isGroupGenderValid(members: Person[]): boolean {
  const males = members.filter((m) => m.gender === 'M');
  const females = members.filter((m) => m.gender === 'F');
  if (males.length === 0 || females.length === 0) return true;
  if (males.length === females.length) return true;
  const minority = males.length < females.length ? males : females;
  const majority = males.length < females.length ? females : males;
  for (const m of minority) {
    const hasLink = majority.some(
      (maj) => maj.mustBeWithIds.includes(m.id) || m.mustBeWithIds.includes(maj.id)
    );
    if (!hasLink) return false;
  }
  return true;
}

/**
 * must-be-with is SYMMETRIC: A → B alone means A and B are the same unit. The
 * relationship is modelled as an undirected graph so the outcome does not
 * depend on the order people are iterated in.
 *
 * Cleanup: anyone whose partner is missing (not eligible, or removed) is
 * removed, and the removal propagates in both directions along the edges.
 */
function resolveMustBeWithUnits(
  eligible: Person[],
  everyone: Person[] = eligible,
): { units: Unit[]; removed: Person[] } {
  const eligibleById = new Map(eligible.map((p) => [p.id, p]));
  const adjacency = new Map<string, Set<string>>();
  for (const p of eligible) adjacency.set(p.id, new Set());

  const toRemove = new Set<string>();

  for (const p of eligible) {
    for (const partnerId of p.mustBeWithIds) {
      const partner = eligibleById.get(partnerId);
      if (!partner) {
        // Partner is not eligible (or unknown) → p cannot be assigned.
        toRemove.add(p.id);
        continue;
      }
      // Undirected edge: A → B and B → A express the same constraint.
      adjacency.get(p.id)?.add(partnerId);
      adjacency.get(partnerId)?.add(p.id);
    }
  }
  // The reverse edge: someone NOT eligible who must go with an eligible person
  // (A → B, A unavailable) means B cannot go alone either.
  for (const q of everyone) {
    if (eligibleById.has(q.id)) continue;
    for (const partnerId of q.mustBeWithIds) {
      if (eligibleById.has(partnerId)) toRemove.add(partnerId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const p of eligible) {
      if (toRemove.has(p.id)) continue;
      for (const partnerId of adjacency.get(p.id) ?? []) {
        if (toRemove.has(partnerId)) {
          toRemove.add(p.id);
          changed = true;
          break;
        }
      }
    }
  }

  const remaining = eligible.filter((p) => !toRemove.has(p.id));
  const removed = eligible.filter((p) => toRemove.has(p.id));
  const remainingById = new Map(remaining.map((p) => [p.id, p]));

  const visited = new Set<string>();
  const units: Unit[] = [];

  for (const p of remaining) {
    if (visited.has(p.id)) continue;
    const component: Person[] = [];
    const queue: string[] = [p.id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const current = remainingById.get(currentId);
      if (!current) continue;
      component.push(current);
      for (const partnerId of adjacency.get(currentId) ?? []) {
        if (!visited.has(partnerId) && remainingById.has(partnerId)) {
          queue.push(partnerId);
        }
      }
    }
    units.push({ members: component });
  }

  return { units, removed };
}

export function generateSchedule(
  people: Person[],
  slots: TimeSlot[],
  startDate: string,
  endDate: string,
  scheduleName: string,
  blackouts: SlotBlackout[] = [],
  seedOrOptions?: number | GenerateScheduleOptions
): ScheduleResult {
  const options: GenerateScheduleOptions =
    typeof seedOrOptions === 'number' ? { seed: seedOrOptions } : seedOrOptions ?? {};
  const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff) >>> 0;
  const rand = mulberry32(seed);
  const placeById = new Map((options.places ?? []).map((p) => [p.id, p]));
  const placeName = (placeId: string): string | undefined => placeById.get(placeId)?.name;

  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const weeks = getOverlappingWeeks(start, end);

  const sortedSlots = [...slots].sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startTime.localeCompare(b.startTime);
  });

  const counter: Record<string, number> = {};
  const slotCounter: Record<string, Record<string, number>> = {};
  for (const p of people) {
    counter[p.id] = 0;
    slotCounter[p.id] = {};
  }

  const targetOf = (p: Person) =>
    typeof p.targetAppearances === 'number' && p.targetAppearances > 0
      ? p.targetAppearances
      : 999;

  const entries: ScheduleEntry[] = [];
  // Deduplicated warnings: identical message text collapses into one entry with a count.
  const warningCounts = new Map<string, number>();
  const addWarning = (message: string): void => {
    warningCounts.set(message, (warningCounts.get(message) ?? 0) + 1);
  };
  // A person may appear at most once per calendar date.
  const bookedByDate = new Map<string, Set<string>>();

  for (const monday of weeks) {
    const weekRefDate = monday < start ? start : monday;
    const weekLabel = formatWeekLabel(weekRefDate);
    const weekDate = toISOLocal(weekRefDate);

    for (const slot of sortedSlots) {
      const slotDate = getSlotDate(monday, slot.dayOfWeek);

      if (slotDate < start || slotDate > end) continue;

      const slotDateISO = toISOLocal(slotDate);
      if (blackouts.some((b) => b.slotId === slot.id && b.date === slotDateISO)) continue;

      const slotLabel = buildSlotLabel(slot, placeName);
      const eligible = people.filter((p) => p.availableSlotIds.includes(slot.id));

      const { units, removed } = resolveMustBeWithUnits(eligible, people);

      const retained = new Set(units.flatMap((u) => u.members.map((m) => m.id)));
      for (const p of removed) {
        const related = new Set<string>(p.mustBeWithIds);
        for (const e of eligible) if (e.mustBeWithIds.includes(p.id)) related.add(e.id);
        const missingNames = [...related]
          .filter((id) => !retained.has(id))
          .map((id) => people.find((x) => x.id === id)?.name ?? id);
        if (missingNames.length > 0) {
          addWarning(
            `${p.name}: no puede asignarse en ${slotLabel} (falta ${missingNames.join(', ')})`
          );
        }
      }

      for (let i = units.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const ui = units[i];
        const uj = units[j];
        if (ui && uj) {
          units[i] = uj;
          units[j] = ui;
        }
      }

      const scoreOf = (u: Unit) => {
        const under = u.members.some((m) => (counter[m.id] ?? 0) < targetOf(m)) ? 0 : 1;
        const slotMin = Math.min(...u.members.map((m) => slotCounter[m.id]?.[slot.id] ?? 0));
        const totalMin = Math.min(...u.members.map((m) => counter[m.id] ?? 0));
        return { under, slotMin, totalMin };
      };
      units.sort((a, b) => {
        const sa = scoreOf(a);
        const sb = scoreOf(b);
        if (sa.under !== sb.under) return sa.under - sb.under;
        if (sa.slotMin !== sb.slotMin) return sa.slotMin - sb.slotMin;
        return sa.totalMin - sb.totalMin;
      });

      const bookedToday = bookedByDate.get(slotDateISO);
      const isBookedToday = (m: Person): boolean => bookedToday?.has(m.id) ?? false;

      const selectedPeople: Person[] = [];
      const skippedForGender: Person[] = [];

      for (const unit of units) {
        if (selectedPeople.length >= slot.groupSize) break;
        // Never assign someone who already has a slot on this same date.
        if (unit.members.some(isBookedToday)) continue;
        if (selectedPeople.length + unit.members.length <= slot.groupSize) {
          const candidate = [...selectedPeople, ...unit.members];
          if (candidate.length === slot.groupSize && !isGroupGenderValid(candidate)) {
            for (const m of unit.members) skippedForGender.push(m);
            continue;
          }
          for (const m of unit.members) selectedPeople.push(m);
        } else if (unit.members.length === 1 && unit.members[0]) {
          const only = unit.members[0];
          const candidate = [...selectedPeople, only];
          if (candidate.length === slot.groupSize && !isGroupGenderValid(candidate)) {
            skippedForGender.push(only);
            continue;
          }
          selectedPeople.push(only);
        } else {
          addWarning(
            `${slotLabel}: el grupo requerido (${unit.members.map((m) => m.name).join(', ')}) no entra en el turno de ${slot.groupSize}`
          );
        }
      }

      if (selectedPeople.length < slot.groupSize && skippedForGender.length > 0) {
        const used = new Set(selectedPeople.map((p) => p.id));
        for (const p of skippedForGender) {
          if (selectedPeople.length >= slot.groupSize) break;
          if (used.has(p.id) || isBookedToday(p)) continue;
          selectedPeople.push(p);
          used.add(p.id);
        }
        if (selectedPeople.length === slot.groupSize) {
          addWarning(
            `${slotLabel}: completado rompiendo regla de género; revisá manualmente si corresponde`
          );
        }
      }

      const selected: string[] = selectedPeople.map((p) => p.id);

      if (selected.length < slot.groupSize && selected.length > 0) {
        addWarning(`${slotLabel}: faltan ${slot.groupSize - selected.length} publicadores`);
      }

      if (selected.length > 0) {
        for (const id of selected) {
          counter[id] = (counter[id] ?? 0) + 1;
          const sc = (slotCounter[id] ??= {});
          sc[slot.id] = (sc[slot.id] ?? 0) + 1;
        }
        const booked = bookedToday ?? new Set<string>();
        for (const id of selected) booked.add(id);
        bookedByDate.set(slotDateISO, booked);
        entries.push({ weekLabel, weekDate, slotId: slot.id, personIds: selected });
      }
    }
  }

  const warnings = [...warningCounts.entries()].map(([message, count]) =>
    count > 1 ? `${message} (×${count})` : message
  );

  return {
    config: { name: scheduleName, startDate, endDate, entries },
    warnings,
  };
}
