// Semana del programa: lunes → domingo. El martes de entre semana y el sábado del fin de semana caen en la misma semana.

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseIso(iso: string): Date {
  const [y = NaN, m = NaN, d = NaN] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// Lunes de la semana del programa que contiene `base` (por defecto hoy).
export function weekStartFor(base: Date = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const back = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - back);
  return toIso(d);
}

export function dayLabel(iso: string): string {
  const d = parseIso(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function weekRangeLabel(startIso: string): string {
  const end = addDays(startIso, 6);
  const s = parseIso(startIso);
  const e = parseIso(end);
  return `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTHS_SHORT[e.getMonth()]} ${e.getFullYear()}`;
}
