/**
 * Programa screen model. The `data` jsonb of `program_weeks` follows
 * packages/core/src/programa/types.ts, but it comes from an editor's upload and may
 * have been written by v1, so everything here validates field by field and renders
 * whatever is present instead of failing the whole week.
 */
import {
  personName,
  type MidweekPart,
  type MidweekSection,
  type MidweekWeek,
  type ProgramaPerson,
  type WeekendDiscourse,
  type WeekendMeeting,
} from '@territorios/core';
import { matchesMe } from '../../lib/me';
import { DAY_NAME, fromIso, longDate, mondayOf, toIso } from '../../lib/week';

export const SECTION_ORDER: readonly MidweekSection[] = ['inicio', 'tesoros', 'maestros', 'vida'];

export const SECTION_LABEL: Record<MidweekSection, string> = {
  inicio: 'Inicio',
  tesoros: 'Tesoros de la Biblia',
  maestros: 'Seamos mejores maestros',
  vida: 'Nuestra vida cristiana',
};

/** The printed programme colours: Tesoros grey, Maestros gold, Vida bordó. `inicio` has none. */
export const SECTION_COLOR: Partial<Record<MidweekSection, string>> = {
  tesoros: '#626262',
  maestros: '#C18626',
  vida: '#961526',
};

const SECTION_SET = new Set<string>(SECTION_ORDER);

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizePeople(raw: unknown): ProgramaPerson[] {
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

/** Parts whose JSONB lost its date fall back to the row key (the Tuesday). */
export function sanitizeMidweek(raw: unknown, fallbackDate: string): MidweekWeek | null {
  if (!isRecord(raw)) return null;
  const parts: MidweekPart[] = [];
  if (Array.isArray(raw.parts)) {
    for (const item of raw.parts) {
      if (!isRecord(item)) continue;
      const title = str(item.title);
      if (!title) continue;
      const section = str(item.section);
      parts.push({
        time: str(item.time),
        title,
        section: (SECTION_SET.has(section) ? section : 'inicio') as MidweekSection,
        people: sanitizePeople(item.people),
      });
    }
  }
  return { date: str(raw.date) || fallbackDate, asamblea: str(raw.asamblea) || null, parts };
}

function sanitizeDiscurso(raw: unknown): WeekendDiscourse | null {
  if (!isRecord(raw)) return null;
  const tipo = str(raw.tipo);
  const titulo = str(raw.titulo);
  if (!tipo && !titulo) return null;
  return {
    tipo,
    titulo,
    // A string (legacy, unlinked) or {name, person_id} (linked): the screen shows the name.
    orador: personName(raw.orador) || null,
    congregacion: str(raw.congregacion) || null,
    saliente: str(raw.saliente) || null,
  };
}

export function sanitizeWeekend(raw: unknown, fallbackDate: string): WeekendMeeting | null {
  if (!isRecord(raw)) return null;
  const one = (k: string) => str(raw[k]) || null;
  // Person fields are a name (legacy, unlinked) or {name, person_id} (linked).
  const who = (k: string) => personName(raw[k]) || null;
  return {
    date: str(raw.date) || fallbackDate,
    asamblea: one('asamblea'),
    presidente: who('presidente'),
    cancionInicio: one('cancionInicio'),
    cancionIntermedia: one('cancionIntermedia'),
    conductor: who('conductor'),
    lector: who('lector'),
    cancionFin: one('cancionFin'),
    oracionFinal: who('oracionFinal'),
    discurso: sanitizeDiscurso(raw.discurso),
  };
}

/** Does the weekend meeting have anything to show beyond its asamblea note? */
export function weekendHasContent(m: WeekendMeeting): boolean {
  return Boolean(
    m.presidente ||
      m.conductor ||
      m.lector ||
      m.cancionInicio ||
      m.cancionIntermedia ||
      m.cancionFin ||
      m.oracionFinal ||
      m.discurso,
  );
}

export function midweekHasContent(w: MidweekWeek): boolean {
  return w.parts.length > 0;
}

/** "Martes 13 de octubre". */
export function dayHeading(iso: string): string {
  const d = fromIso(iso);
  return `${DAY_NAME[d.getDay()]} ${longDate(d)}`;
}

const SHORT_MONTH = [
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
];

/** "12–18 oct", or "28 sep – 4 oct" across months: short enough for a 390 px header caption. */
export function shortRange(startIso: string, endIso: string): string {
  const a = fromIso(startIso);
  const b = fromIso(endIso);
  const month = (d: Date) => SHORT_MONTH[d.getMonth()];
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

/** "Martes 13" — compact day for the "Mis partes" rows. */
export function shortDay(iso: string): string {
  const d = fromIso(iso);
  return `${DAY_NAME[d.getDay()]} ${d.getDate()}`;
}

export interface PartGroup {
  section: MidweekSection;
  parts: MidweekPart[];
}

/** Parts grouped by section, in the programme's own order; empty sections are dropped. */
export function groupParts(parts: MidweekPart[]): PartGroup[] {
  const bySection = new Map<MidweekSection, MidweekPart[]>();
  for (const part of parts) {
    const list = bySection.get(part.section) ?? [];
    list.push(part);
    bySection.set(part.section, list);
  }
  return SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => ({
    section,
    parts: bySection.get(section) ?? [],
  }));
}

export interface MyPart {
  key: string;
  day: string;
  time: string | null;
  title: string;
  role: string | null;
}

/**
 * The parts where "Soy…" appears: midweek parts plus the weekend meeting roles.
 * Members open Programa to find their own name first.
 */
export function myParts(midweek: MidweekWeek | null, weekend: WeekendMeeting | null, me: string): MyPart[] {
  if (!me.trim()) return [];
  const out: MyPart[] = [];

  if (midweek) {
    for (const part of midweek.parts) {
      const hit = part.people.find((p) => matchesMe(me, p.name));
      if (!hit) continue;
      out.push({
        key: `entre-semana-${part.section}-${part.time}-${part.title}`,
        day: shortDay(midweek.date),
        time: part.time || null,
        title: part.title,
        role: hit.role ?? null,
      });
    }
  }

  if (weekend) {
    const roles: Array<[string, string | null]> = [
      ['Presidente', weekend.presidente],
      ['Conductor', weekend.conductor],
      ['Lector', weekend.lector],
      ['Oración final', weekend.oracionFinal],
    ];
    if (weekend.discurso?.orador) {
      roles.push([`Discurso ${weekend.discurso.tipo.toLowerCase()}`.trim(), weekend.discurso.orador]);
    }
    for (const [role, name] of roles) {
      if (!name || !matchesMe(me, name)) continue;
      out.push({
        key: `fin-de-semana-${role}`,
        day: shortDay(weekend.date),
        time: null,
        title: 'Reunión del fin de semana',
        role,
      });
    }
  }

  return out;
}

/** `?semana=` accepts any date inside the week and normalises to its Monday. */
export function parseSemanaParam(value: string | null, now: Date = new Date()): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = fromIso(value);
    // Round-trip check: "2026-02-31" rolls over in the Date and is not a real date.
    if (!Number.isNaN(d.getTime()) && toIso(d) === value) return mondayOf(d);
  }
  return mondayOf(now);
}
