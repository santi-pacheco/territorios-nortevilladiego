// Programa semanal: datos extraídos de los PDF mensuales de JW.org.
// Las claves son fechas ISO (YYYY-MM-DD) para poder fusionar meses sin pisarse.

export type MidweekSection = 'inicio' | 'tesoros' | 'maestros' | 'vida';

export interface ProgramaPerson {
  name: string;
  role?: string; // "Presidente" | "Lector" | "Conductor"
  /** people.id when the editor linked the entry to a person; `name` stays as the display snapshot. */
  person_id?: string;
}

export interface MidweekPart {
  time: string; // "19:06"
  title: string;
  section: MidweekSection;
  people: ProgramaPerson[];
}

export interface MidweekWeek {
  date: string; // martes ISO
  asamblea: string | null;
  parts: MidweekPart[];
}

export interface WeekendDiscourse {
  tipo: string; // "PÚBLICO" | "ESPECIAL"
  titulo: string;
  orador: string | null;
  congregacion: string | null;
  saliente: string | null;
}

export interface WeekendMeeting {
  date: string; // sábado ISO
  asamblea: string | null;
  presidente: string | null;
  /** Canción inicial (antes del presidente); texto libre: número + título. */
  cancionInicio: string | null;
  /** Canción antes de La Atalaya (antes del conductor/lector). */
  cancionIntermedia: string | null;
  conductor: string | null;
  lector: string | null;
  cancionFin: string | null;
  oracionFinal: string | null;
  discurso: WeekendDiscourse | null;
}

/** A weekend person linked (or not yet) to a people row. */
export interface PersonRef {
  name: string;
  person_id?: string;
}

/**
 * A weekend person as stored in `program_weeks.data`: a plain name (legacy, and every unlinked
 * value) or `{name, person_id}` when linked. Read it with `personName` / `personLink`.
 */
export type StoredPerson = string | PersonRef;

/** `WeekendDiscourse` as stored: the orador may be linked. */
export interface WeekendDiscourseData extends Omit<WeekendDiscourse, 'orador'> {
  orador: StoredPerson | null;
}

/**
 * `WeekendMeeting` as stored. `WeekendMeeting` itself is the display shape (names only) that the
 * PDF parser produces and the screens render.
 */
export interface WeekendMeetingData
  extends Omit<WeekendMeeting, 'presidente' | 'conductor' | 'lector' | 'oracionFinal' | 'discurso'> {
  presidente: StoredPerson | null;
  conductor: StoredPerson | null;
  lector: StoredPerson | null;
  oracionFinal: StoredPerson | null;
  discurso: WeekendDiscourseData | null;
}

/** The weekend fields that name a person. */
export const WEEKEND_PERSON_FIELDS = ['presidente', 'conductor', 'lector', 'oracionFinal'] as const;
export type WeekendPersonField = (typeof WEEKEND_PERSON_FIELDS)[number];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Display name of a stored person value (string or `{name}`), trimmed; '' for anything else. */
export function personName(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (isPlainObject(v) && typeof v.name === 'string') return v.name.trim();
  return '';
}

/** The linked people.id of a stored person value, or null (legacy string, no id, malformed). */
export function personLink(v: unknown): string | null {
  if (!isPlainObject(v) || typeof v.person_id !== 'string') return null;
  const id = v.person_id.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/**
 * The stored form of a person: `{name, person_id}` when linked, the bare name otherwise (so
 * unlinked values keep the legacy shape older clients read), null when blank.
 */
export function storePerson(name: string, personId: string | null | undefined): StoredPerson | null {
  const n = name.trim();
  if (!n) return null;
  return personId ? { name: n, person_id: personId } : n;
}

export interface ProgramaData {
  midweek: Record<string, MidweekWeek>;
  weekend: Record<string, WeekendMeeting>;
}

export const EMPTY_PROGRAMA: ProgramaData = { midweek: {}, weekend: {} };

// Un fragmento de texto del PDF con su posición (pts, origen abajo-izquierda).
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  font: string;
}
