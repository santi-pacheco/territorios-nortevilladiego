/**
 * Gestión ▸ Programa ▸ Editar: pure helpers for the manual week editor.
 *
 * No React here. The component layer owns the state; this module owns the shapes.
 * `program_weeks.data` follows packages/core/src/programa/types.ts but may come from a PDF
 * upload or from v1, so every field is validated before it reaches an input, and cleaned
 * again before it is saved (empty rows and blank people do not go to the database).
 */
import type {
  MidweekPart,
  MidweekSection,
  MidweekWeek,
  ProgramaPerson,
  WeekendDiscourse,
  WeekendMeeting,
} from '@territorios/core';
import { addDaysIso, fromIso, mondayOf } from '../../../../lib/week';

export const SECTION_ORDER: readonly MidweekSection[] = ['inicio', 'tesoros', 'maestros', 'vida'];

export const SECTION_LABEL: Record<MidweekSection, string> = {
  inicio: 'Inicio',
  tesoros: 'Tesoros de la Biblia',
  maestros: 'Seamos mejores maestros',
  vida: 'Nuestra vida cristiana',
};

export const DISCOURSE_TIPOS = ['PÚBLICO', 'ESPECIAL'] as const;

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
] as const;

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
/** The midweek row of a Mon–Sun week is keyed by its Tuesday. */
export function midweekDate(weekStart: string): string {
  return addDaysIso(weekStart, 1);
}

/** The weekend row of a Mon–Sun week is keyed by its Saturday. */
export function weekendDate(weekStart: string): string {
  return addDaysIso(weekStart, 5);
}

/** Every Monday week that overlaps the calendar month (4 or 5 of them). */
export function weekStartsOfMonth(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const out: string[] = [];
  let monday = mondayOf(first);
  while (fromIso(monday).getTime() <= last.getTime()) {
    out.push(monday);
    monday = addDaysIso(monday, 7);
  }
  return out;
}

/** Month arithmetic for the picker; `month` is 0-based like `Date`. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month] ?? ''} ${year}`;
}

/** "6 – 12 oct" / "28 sep – 4 oct" for a week header. */
export function weekLabel(weekStart: string): string {
  const s = fromIso(weekStart);
  const e = fromIso(addDaysIso(weekStart, 6));
  const sm = MONTHS_SHORT[s.getMonth()] ?? '';
  const em = MONTHS_SHORT[e.getMonth()] ?? '';
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()} – ${e.getDate()} ${em}`
    : `${s.getDate()} ${sm} – ${e.getDate()} ${em}`;
}

// ---------------------------------------------------------------------------
// Empty templates
// ---------------------------------------------------------------------------
export function emptyMidweek(date: string): MidweekWeek {
  return { date, asamblea: null, parts: [] };
}

export function emptyWeekend(date: string): WeekendMeeting {
  return {
    date,
    asamblea: null,
    presidente: null,
    cancionInicio: null,
    conductor: null,
    lector: null,
    cancionFin: null,
    oracionFinal: null,
    discurso: null,
  };
}

// ---------------------------------------------------------------------------
// Read: shape whatever is stored into the core types
// ---------------------------------------------------------------------------
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function sanitizePeople(raw: unknown): ProgramaPerson[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgramaPerson[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    if (!name) continue;
    const role = str(item.role);
    out.push(role ? { name, role } : { name });
  }
  return out;
}

export function sanitizeMidweek(raw: unknown, fallbackDate: string): MidweekWeek {
  const src = isRecord(raw) ? raw : {};
  const parts: MidweekPart[] = [];
  if (Array.isArray(src.parts)) {
    for (const item of src.parts) {
      if (!isRecord(item)) continue;
      const title = str(item.title);
      if (!title) continue;
      const section = str(item.section);
      parts.push({
        time: str(item.time),
        title,
        section: (SECTION_ORDER as readonly string[]).includes(section)
          ? (section as MidweekSection)
          : 'inicio',
        people: sanitizePeople(item.people),
      });
    }
  }
  return { date: str(src.date) || fallbackDate, asamblea: str(src.asamblea) || null, parts };
}

function sanitizeDiscourse(raw: unknown): WeekendDiscourse | null {
  if (!isRecord(raw)) return null;
  const d: WeekendDiscourse = {
    tipo: str(raw.tipo),
    titulo: str(raw.titulo),
    orador: str(raw.orador) || null,
    congregacion: str(raw.congregacion) || null,
    saliente: str(raw.saliente) || null,
  };
  return discourseHasContent(d) ? d : null;
}

export function sanitizeWeekend(raw: unknown, fallbackDate: string): WeekendMeeting {
  const src = isRecord(raw) ? raw : {};
  const one = (k: string) => str(src[k]) || null;
  return {
    date: str(src.date) || fallbackDate,
    asamblea: one('asamblea'),
    presidente: one('presidente'),
    cancionInicio: one('cancionInicio'),
    conductor: one('conductor'),
    lector: one('lector'),
    cancionFin: one('cancionFin'),
    oracionFinal: one('oracionFinal'),
    discurso: sanitizeDiscourse(src.discurso),
  };
}

// ---------------------------------------------------------------------------
// Content checks (does the meeting deserve a row?)
// ---------------------------------------------------------------------------
export function hasMidweekContent(w: MidweekWeek): boolean {
  return Boolean(w.asamblea?.trim()) || w.parts.length > 0;
}

function discourseHasContent(d: WeekendDiscourse | null): boolean {
  return Boolean(
    d &&
      (d.tipo.trim() ||
        d.titulo.trim() ||
        d.orador?.trim() ||
        d.congregacion?.trim() ||
        d.saliente?.trim()),
  );
}

export function hasWeekendContent(m: WeekendMeeting): boolean {
  return Boolean(
    m.asamblea?.trim() ||
      m.presidente?.trim() ||
      m.conductor?.trim() ||
      m.lector?.trim() ||
      m.oracionFinal?.trim() ||
      m.cancionInicio?.trim() ||
      m.cancionFin?.trim() ||
      discourseHasContent(m.discurso),
  );
}

// ---------------------------------------------------------------------------
// Write: trim, drop blanks, clamp the date to the row key
// ---------------------------------------------------------------------------
export function cleanPeople(people: readonly ProgramaPerson[]): ProgramaPerson[] {
  const out: ProgramaPerson[] = [];
  for (const p of people) {
    const name = p.name.trim();
    if (!name) continue;
    const role = p.role?.trim() ?? '';
    out.push(role ? { name, role } : { name });
  }
  return out;
}

export function cleanMidweek(w: MidweekWeek, date: string): MidweekWeek {
  const asamblea = w.asamblea?.trim() || null;
  // An assembly week has no parts: the editor hides them, dropping them here keeps the row true
  // to the core type and to what the member screen renders.
  if (asamblea) return { date, asamblea, parts: [] };
  const parts: MidweekPart[] = [];
  for (const p of w.parts) {
    const title = p.title.trim();
    if (!title) continue;
    parts.push({ time: p.time.trim(), title, section: p.section, people: cleanPeople(p.people) });
  }
  return { date, asamblea: null, parts };
}

function cleanDiscourse(d: WeekendDiscourse | null): WeekendDiscourse | null {
  if (!d) return null;
  const disc: WeekendDiscourse = {
    tipo: d.tipo.trim(),
    titulo: d.titulo.trim(),
    orador: d.orador?.trim() || null,
    congregacion: d.congregacion?.trim() || null,
    saliente: d.saliente?.trim() || null,
  };
  return discourseHasContent(disc) ? disc : null;
}

export function cleanWeekend(m: WeekendMeeting, date: string): WeekendMeeting {
  const one = (v: string | null) => v?.trim() || null;
  return {
    date,
    asamblea: one(m.asamblea),
    presidente: one(m.presidente),
    cancionInicio: one(m.cancionInicio),
    conductor: one(m.conductor),
    lector: one(m.lector),
    cancionFin: one(m.cancionFin),
    oracionFinal: one(m.oracionFinal),
    discurso: cleanDiscourse(m.discurso),
  };
}

// ---------------------------------------------------------------------------
// "Copiar estructura de la semana anterior": sections, times and titles, no people.
// ---------------------------------------------------------------------------
export function copyPartsFrom(prev: MidweekWeek | null | undefined): MidweekPart[] {
  return (prev?.parts ?? []).map((p) => ({
    section: p.section,
    time: p.time,
    title: p.title,
    people: [],
  }));
}

// ---------------------------------------------------------------------------
// Pure part/person reducers used by the editors
// ---------------------------------------------------------------------------
export function addPart(parts: readonly MidweekPart[]): MidweekPart[] {
  const section = parts[parts.length - 1]?.section ?? 'inicio';
  return [...parts, { time: '', title: '', section, people: [] }];
}

export function setPart(
  parts: readonly MidweekPart[],
  index: number,
  patch: Partial<MidweekPart>,
): MidweekPart[] {
  return parts.map((p, i) => (i === index ? { ...p, ...patch } : p));
}

export function removePart(parts: readonly MidweekPart[], index: number): MidweekPart[] {
  return parts.filter((_, i) => i !== index);
}

export function movePart(parts: readonly MidweekPart[], index: number, delta: number): MidweekPart[] {
  const target = index + delta;
  if (target < 0 || target >= parts.length) return [...parts];
  const next = [...parts];
  const a = next[index];
  const b = next[target];
  if (!a || !b) return next;
  next[index] = b;
  next[target] = a;
  return next;
}

export function addPerson(parts: readonly MidweekPart[], index: number): MidweekPart[] {
  const people = parts[index]?.people ?? [];
  return setPart(parts, index, { people: [...people, { name: '', role: '' }] });
}

export function removePerson(
  parts: readonly MidweekPart[],
  partIndex: number,
  personIndex: number,
): MidweekPart[] {
  const part = parts[partIndex];
  if (!part) return [...parts];
  return setPart(parts, partIndex, {
    people: part.people.filter((_, i) => i !== personIndex),
  });
}

export function setPerson(
  parts: readonly MidweekPart[],
  partIndex: number,
  personIndex: number,
  patch: Partial<ProgramaPerson>,
): MidweekPart[] {
  const part = parts[partIndex];
  if (!part) return [...parts];
  return setPart(parts, partIndex, {
    people: part.people.map((p, i) => (i === personIndex ? { ...p, ...patch } : p)),
  });
}
