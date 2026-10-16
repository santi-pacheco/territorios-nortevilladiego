import type { SalidasSchedule, DayEntry, ScheduleData, DaySchedule, Assignment } from './types';
import { dayNumberForDow } from './salidasStore';
import { dayDefByDow } from './days';

// "5, 12" / "5-12" / "16" / "5 y 12" → ids únicos. Igual que csv.ts.
function parseTerritoryIds(raw: string): number[] {
  if (!raw) return [];
  const parts = raw.split(/[-,/]|\s+y\s+|\s+&\s+|\s+/).map((s) => s.trim()).filter(Boolean);
  const ids: number[] = [];
  for (const p of parts) if (/^\d+$/.test(p)) ids.push(Number(p));
  return Array.from(new Set(ids));
}

function titleCaseMes(mes: string): string {
  if (!mes) return '';
  return mes.charAt(0).toUpperCase() + mes.slice(1).toLowerCase();
}

function dayToAssignments(day: DayEntry): Assignment[] {
  if (day.kind === 'domingo') {
    return day.domingoSlots
      .filter((s) => s.hora || s.lugar || s.conductor || s.territorioNumero || s.grupos)
      .map((s) => ({
        uid: s.id,
        time: s.hora,
        corner: s.lugar,
        groups: s.grupos,
        leader: s.conductor,
        territoryIds: parseTerritoryIds(s.territorioNumero),
      }));
  }
  return day.slots
    .filter((s) => s.hora || s.lugar || s.grupos || s.conductor || s.territorio)
    .map((s) => ({
      uid: s.id,
      time: s.hora,
      corner: s.lugar,
      groups: s.grupos,
      leader: s.conductor,
      territoryIds: parseTerritoryIds(s.territorio),
    }));
}

export function salidasToScheduleData(schedule: SalidasSchedule): ScheduleData {
  const mesLabel = titleCaseMes(schedule.mes);
  const ws = schedule.weekStart;

  const days: DaySchedule[] = schedule.days.map((day) => {
    const def = dayDefByDow(day.dow);
    const num = dayNumberForDow(ws, day.dow);
    return {
      key: def?.key ?? `dow-${day.dow}`,
      label: def?.label ?? 'Día',
      short: def?.short ?? '—',
      dow: day.dow,
      date: num != null && mesLabel ? `${num} de ${mesLabel}` : undefined,
      assignments: dayToAssignments(day),
    };
  });

  const first = schedule.days[0];
  const last = schedule.days[schedule.days.length - 1];
  const nFirst = first ? dayNumberForDow(ws, first.dow) : null;
  const nLast = last ? dayNumberForDow(ws, last.dow) : null;
  const weekLabel =
    nFirst != null && nLast != null && mesLabel
      ? nFirst === nLast
        ? `${nFirst} de ${mesLabel}`
        : `${nFirst} - ${nLast} de ${mesLabel}`
      : mesLabel || null;

  return { weekLabel, days };
}
