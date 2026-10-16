import type { Person, TimeSlot, ScheduleConfig, ScheduleEntry, SlotBlackout } from './types';

export interface ScheduleResult {
  config: ScheduleConfig;
  warnings: string[];
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
      (maj) => m.mustBeWithIds.includes(maj.id) || maj.mustBeWithIds.includes(m.id)
    );
    if (!hasLink) return false;
  }
  return true;
}

function resolveMustBeWithUnits(eligible: Person[]): { units: Unit[]; removed: Person[] } {
  const eligibleSet = new Set(eligible.map((p) => p.id));

  const toRemove = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of eligible) {
      if (toRemove.has(p.id)) continue;
      for (const partnerId of p.mustBeWithIds) {
        if (!eligibleSet.has(partnerId) || toRemove.has(partnerId)) {
          toRemove.add(p.id);
          changed = true;
          break;
        }
      }
    }
  }

  const remaining = eligible.filter((p) => !toRemove.has(p.id));
  const removed = eligible.filter((p) => toRemove.has(p.id));

  const visited = new Set<string>();
  const units: Unit[] = [];

  for (const p of remaining) {
    if (visited.has(p.id)) continue;
    const component: Person[] = [];
    const queue: Person[] = [p];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      component.push(current);
      for (const partnerId of current.mustBeWithIds) {
        const partner = remaining.find((x) => x.id === partnerId);
        if (partner && !visited.has(partner.id)) {
          queue.push(partner);
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
  blackouts: SlotBlackout[] = []
): ScheduleResult {
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
    p.targetAppearances && p.targetAppearances > 0 ? p.targetAppearances : 999;

  const entries: ScheduleEntry[] = [];
  const warnings: string[] = [];

  for (const monday of weeks) {
    const weekRefDate = monday < start ? start : monday;
    const weekLabel = formatWeekLabel(weekRefDate);
    const weekDate = toISOLocal(weekRefDate);

    for (const slot of sortedSlots) {
      const slotDate = getSlotDate(monday, slot.dayOfWeek);

      if (slotDate < start || slotDate > end) continue;

      const slotDateISO = toISOLocal(slotDate);
      if (blackouts.some((b) => b.slotId === slot.id && b.date === slotDateISO)) continue;

      const eligible = people.filter((p) => p.availableSlotIds.includes(slot.id));

      const { units, removed } = resolveMustBeWithUnits(eligible);

      for (const p of removed) {
        const missingPartners = p.mustBeWithIds.filter(
          (mid) => !eligible.find((e) => e.id === mid) || removed.find((r) => r.id === mid)
        );
        const missingNames = missingPartners.map((mid) => {
          const partner = people.find((x) => x.id === mid);
          return partner ? partner.name : mid;
        });
        warnings.push(
          `${p.name} no puede asignarse en "${slot.dayOfWeek} ${slot.startTime}" semana del ${weekLabel}: falta ${missingNames.join(', ')}`
        );
      }

      for (let i = units.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
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

      const selectedPeople: Person[] = [];
      const skippedForGender: Person[] = [];

      for (const unit of units) {
        if (selectedPeople.length >= slot.groupSize) break;
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
          warnings.push(
            `Grupo mustBeWith (${unit.members.map((m) => m.name).join(', ')}) excede el tamaño del turno (${slot.groupSize}) en semana del ${weekLabel}`
          );
        }
      }

      if (selectedPeople.length < slot.groupSize && skippedForGender.length > 0) {
        const used = new Set(selectedPeople.map((p) => p.id));
        for (const p of skippedForGender) {
          if (selectedPeople.length >= slot.groupSize) break;
          if (used.has(p.id)) continue;
          selectedPeople.push(p);
          used.add(p.id);
        }
        if (selectedPeople.length === slot.groupSize) {
          warnings.push(
            `Turno del ${weekLabel} (${slot.startTime}): completado rompiendo regla de género. Editá manualmente si corresponde.`
          );
        }
      }

      const selected: string[] = selectedPeople.map((p) => p.id);

      if (selected.length < slot.groupSize && selected.length > 0) {
        warnings.push(
          `Turno del ${weekLabel} completado con solo ${selected.length} de ${slot.groupSize} personas disponibles`
        );
      }

      if (selected.length > 0) {
        for (const id of selected) {
          counter[id] = (counter[id] ?? 0) + 1;
          const sc = (slotCounter[id] ??= {});
          sc[slot.id] = (sc[slot.id] ?? 0) + 1;
        }
        entries.push({ weekLabel, weekDate, slotId: slot.id, personIds: selected });
      }
    }
  }

  return {
    config: { name: scheduleName, startDate, endDate, entries },
    warnings,
  };
}
