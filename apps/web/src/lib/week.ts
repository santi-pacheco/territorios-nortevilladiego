/** Date helpers for the Salidas week. All dates are local ISO yyyy-mm-dd strings. */

export const DAY_SLUGS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;
export type DaySlug = (typeof DAY_SLUGS)[number];
/** Token slug used by @territorios/ui-tokens day colours, indexed by JS dow. */
export const DAY_TOKEN = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
] as const;
export const DAY_NAME = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;
export const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Week order on the card and in the strip: Monday first, Sunday last. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIso(d);
}

export function addDaysIso(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** Calendar date of a JS dow inside the week that starts on `monday`. */
export function dateOfDow(monday: string, dow: number): Date {
  return fromIso(addDaysIso(monday, (dow + 6) % 7));
}

export function longDate(d: Date): string {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
}

export function slugToDow(slug: string | undefined): number | null {
  const i = DAY_SLUGS.indexOf(slug as DaySlug);
  return i === -1 ? null : i;
}

/** Minutes since midnight for "HH:MM" (tolerates "9.30", "9:30 hs"). Null when unparseable. */
export function minutesOf(time: string): number | null {
  const m = /(\d{1,2})[:.](\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function untilLabel(mins: number): string {
  if (mins < 60) return `en ${mins} min`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r ? `en ${h} h ${r} min` : `en ${h} h`;
}
