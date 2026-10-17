/**
 * "Pegar desde Excel": rows copied from the roster spreadsheet, tab-separated:
 *   FECHA | COMPUTADORA | SONIDO | MIC | MIC [| ACOMODADOR | ACOMODADOR]
 * Pure functions only (parse, dates, name resolution) so they are unit-tested without a DOM.
 */
import type { DutyDayKind, DutyPerson, DutyRole } from '@territorios/data';
import { fromIso, toIso } from '../../../lib/week';
import { SLOTS, type Month, type Slot } from '../../privilegios/model';

/** Lower case, no accents, single spaces: "  José  PÉREZ " → "jose perez". */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTH_NAMES: string[][] = [
  ['enero'],
  ['febrero'],
  ['marzo'],
  ['abril'],
  ['mayo'],
  ['junio'],
  ['julio'],
  ['agosto'],
  ['septiembre', 'setiembre'],
  ['octubre'],
  ['noviembre'],
  ['diciembre'],
];

/** "sep", "sept", "set", "octubre" → 0-based month; null when it is not a month word. */
function monthOfWord(word: string): number | null {
  if (word.length < 3) return null;
  const i = MONTH_NAMES.findIndex((names) => names.some((n) => n.startsWith(word)));
  return i === -1 ? null : i;
}

const WEEKDAY_PREFIX =
  /^(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\.?,?\s+/;

/**
 * "MARTES 1-sep", "SABADO 3-oct", "13/10", "13-10-2026", "6 de octubre" → ISO date.
 * Without a year: the editor's selected year, rolled to the next one when the month is more
 * than six months before the selected month (pasting January while on December).
 */
export function parsePasteDate(text: string, base: Month): string | null {
  const s = normName(text).replace(WEEKDAY_PREFIX, '');
  let day: number;
  let month: number;
  let year: number | null = null;

  const named = /^(\d{1,2})\s*(?:de\s+|[-/. ]\s*)?([a-z]+)\.?(?:\s*(?:de\s+|[-/. ]\s*)(\d{2,4}))?$/.exec(s);
  const numeric = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*(\d{2,4}))?$/.exec(s);
  if (named) {
    const m = monthOfWord(named[2]!);
    if (m === null) return null;
    day = Number(named[1]);
    month = m;
    if (named[3]) year = Number(named[3]);
  } else if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]) - 1;
    if (numeric[3]) year = Number(numeric[3]);
  } else {
    return null;
  }

  if (year !== null && year < 100) year += 2000;
  if (year === null) year = month < base.month - 6 ? base.year + 1 : base.year;
  if (month < 0 || month > 11) return null;
  const d = new Date(year, month, day);
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return toIso(d);
}

/** "ASAMBLEA REGIONAL" → "Asamblea regional". */
function sentenceCase(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es');
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1);
}

export interface PastedCell extends Slot {
  /** Text as pasted (trimmed, at most 80 characters: the DB limit for free text). */
  raw: string;
}

export interface PastedRow {
  /** 1-based line in the pasted text. */
  line: number;
  date: string;
  kind: DutyDayKind;
  /** Banner text for asamblea / sin reunión rows. */
  note: string | null;
  /** Non-empty cells only; empty pasted cells leave the saved roster as it is. */
  cells: PastedCell[];
  /** The date is not a Tuesday or a Saturday. */
  offDay: boolean;
}

export interface SkippedLine {
  line: number;
  text: string;
}

export interface ParsedPaste {
  rows: PastedRow[];
  skipped: SkippedLine[];
}

const MAX_NAME = 80;

export function parsePaste(text: string, base: Month): ParsedPaste {
  const byDate = new Map<string, PastedRow>();
  const skipped: SkippedLine[] = [];

  text.split(/\r\n|\r|\n/).forEach((lineText, i) => {
    const cells = lineText.split('\t').map((c) => c.trim());
    if (cells.every((c) => c === '')) return;
    const first = cells[0] ?? '';
    if (normName(first) === 'fecha') return; // header row
    const date = parsePasteDate(first, base);
    if (!date) {
      skipped.push({ line: i + 1, text: lineText.trim() });
      return;
    }
    const rest = cells.slice(1);
    const dow = fromIso(date).getDay();
    const row: PastedRow = {
      line: i + 1,
      date,
      kind: 'normal',
      note: null,
      cells: [],
      offDay: dow !== 2 && dow !== 6,
    };
    const mark = rest.find((c) => /^(asamblea|sin reunion)/.test(normName(c)));
    if (mark) {
      row.kind = normName(mark).startsWith('asamblea') ? 'asamblea' : 'sin_reunion';
      row.note = sentenceCase(mark).slice(0, 200);
    } else {
      SLOTS.forEach((slot, j) => {
        const raw = (rest[j] ?? '').replace(/\s+/g, ' ').slice(0, MAX_NAME).trim();
        if (raw) row.cells.push({ ...slot, raw });
      });
    }
    // The same date twice: the later line wins, as in the sheet read top to bottom.
    byDate.set(date, row);
  });

  return { rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), skipped };
}

export type Resolution =
  | { status: 'resolved'; person: DutyPerson }
  | { status: 'ambiguous'; candidates: DutyPerson[] }
  | { status: 'unknown' };

/** People who take a duty, sorted by name. */
export function peopleFor(role: DutyRole, people: DutyPerson[]): DutyPerson[] {
  return people
    .filter((p) => p.duties.includes(role))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** A person whose name or alias is exactly `text` (accent- and case-insensitive). */
export function exactPerson(text: string, pool: DutyPerson[]): DutyPerson[] {
  const n = normName(text);
  if (!n) return [];
  return pool.filter((p) => normName(p.name) === n || p.aliases.some((a) => normName(a) === n));
}

interface Token {
  text: string;
  /** "M." or "M": matches any word starting with it. */
  prefix: boolean;
}

function tokens(s: string): Token[] {
  return normName(s.replace(/\.(?=\S)/g, '. '))
    .split(' ')
    .filter(Boolean)
    .map((t) => {
      const text = t.replace(/\.+$/, '');
      return { text, prefix: t.endsWith('.') || text.length === 1 };
    })
    .filter((t) => t.text);
}

/** Every pasted word matches the start of the name, word by word: "Ana", "Ana M.", "Ana María". */
function startsLike(raw: Token[], name: string): boolean {
  const words = tokens(name).map((t) => t.text);
  return raw.every((t, i) => {
    const w = words[i];
    return w !== undefined && (t.prefix ? w.startsWith(t.text) : w === t.text);
  });
}

/**
 * Resolve a pasted name against the people who take `role`: full name or alias first, then by
 * the start of the name ("Ana" when only one Ana has the duty, "Ana M." for "Ana Martínez").
 * More than one match is ambiguous; none is unknown.
 */
export function resolveName(raw: string, role: DutyRole, people: DutyPerson[]): Resolution {
  const pool = peopleFor(role, people);
  const exact = exactPerson(raw, pool);
  if (exact.length === 1) return { status: 'resolved', person: exact[0]! };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };

  const t = tokens(raw);
  if (t.length === 0) return { status: 'unknown' };
  const like = pool.filter((p) => startsLike(t, p.name) || p.aliases.some((a) => startsLike(t, a)));
  if (like.length === 1) return { status: 'resolved', person: like[0]! };
  if (like.length > 1) return { status: 'ambiguous', candidates: like };
  return { status: 'unknown' };
}
