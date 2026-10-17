/**
 * Pure helpers for the `workbook` function: which issue of the "Guía de actividades para la
 * reunión Vida y Ministerio Cristianos" (pub=mwb) holds a week, and how one week's XHTML file
 * becomes a structure of titles, minutes and songs.
 *
 * Only the structure is kept (titles, minutes, sections, song numbers and the weekly Bible
 * reading). Paragraph text is read just to classify a part and is never returned.
 *
 * The week shape is duplicated in packages/core/src/programa/workbook.ts (`WorkbookWeek`): the
 * function is deployed on its own and must not import from the monorepo.
 */
import { DOMParser } from 'linkedom';

export type WorkbookSection = 'inicio' | 'tesoros' | 'maestros' | 'vida';

export type WorkbookPartKind =
  | 'intro' // Palabras de introducción
  | 'tesoros' // first Tesoros talk
  | 'perlas' // Busquemos perlas escondidas
  | 'lectura' // Lectura de la Biblia (student)
  | 'estudiante' // Seamos mejores maestros student part (student + helper)
  | 'discurso' // Seamos mejores maestros student talk (one student)
  | 'analisis' // "Análisis con el auditorio" (one brother, no counsel)
  | 'parte' // Nuestra vida cristiana part
  | 'estudio' // Estudio bíblico de la congregación
  | 'conclusion'; // Palabras de conclusión

export interface WorkbookPart {
  section: WorkbookSection;
  number: number | null;
  title: string;
  minutes: number;
  kind: WorkbookPartKind;
}

export interface WorkbookWeek {
  weekStart: string; // Monday, YYYY-MM-DD
  label: string; // "12-18 DE OCTUBRE"
  bibleReading: string; // "JEREMÍAS 42-44"
  songs: [number | null, number | null, number | null]; // opening, middle, closing
  parts: WorkbookPart[];
}

export interface Issue {
  year: number;
  month: number; // 1-12, always odd (issues are bimonthly)
}

// ---------------------------------------------------------------------------
// Dates and issues
// ---------------------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isMonday(iso: string): boolean {
  return new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function issueCode(i: Issue): string {
  return `${i.year}${String(i.month).padStart(2, '0')}`;
}

export function shiftIssue(i: Issue, delta: number): Issue {
  const idx = i.year * 12 + (i.month - 1) + delta * 2;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** The issue that normally holds the week starting on `monday`: odd month of its pair. */
export function issueForWeek(monday: string): Issue {
  const year = Number(monday.slice(0, 4));
  const month = Number(monday.slice(5, 7));
  return { year, month: month % 2 === 1 ? month : month - 1 };
}

/**
 * Every Monday week that overlaps the calendar month `YYYY-MM`. Same rule as the web editor's
 * `weekStartsOfMonth`, so both sides agree on which weeks a month has.
 */
export function weekStartsOfMonth(month: string): string[] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  let monday = addDays(first, -((dow + 6) % 7));
  const out: string[] = [];
  while (monday <= last) {
    out.push(monday);
    monday = addDays(monday, 7);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  SETIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

/**
 * "5-11 DE OCTUBRE", "26 DE OCTUBRE A 1 DE NOVIEMBRE", "28 DE DICIEMBRE A 3 DE ENERO".
 * The year comes from the issue; a January week inside a November issue is the next year.
 */
export function weekStartFromLabel(label: string, issue: Issue): string | null {
  const m = /^(\d{1,2})(?:\s+DE\s+([A-ZÁÉÍÓÚ]+))?\s*(?:-|–|\bA\b)\s*\d{1,2}\s+DE\s+([A-ZÁÉÍÓÚ]+)/i.exec(
    label.trim(),
  );
  if (!m) return null;
  const month = MONTHS[(m[2] ?? m[3] ?? '').toUpperCase()];
  if (!month) return null;
  let year = issue.year;
  if (month < issue.month - 2) year += 1;
  else if (month > issue.month + 3) year -= 1;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  return isIsoDate(iso) && isMonday(iso) ? iso : null;
}

// ---------------------------------------------------------------------------
// XHTML → week
// ---------------------------------------------------------------------------
/** Week files are OEBPS/<docId>.xhtml; `*-extracted.xhtml` holds the Bible text and is skipped. */
export function isWeekFile(name: string): boolean {
  return /^OEBPS\/\d+\.xhtml$/.test(name);
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim(); // \s includes NBSP
}

function sectionOf(heading: string): WorkbookSection | null {
  const h = heading.toUpperCase();
  if (h.startsWith('TESOROS')) return 'tesoros';
  if (h.startsWith('SEAMOS')) return 'maestros';
  if (h.startsWith('NUESTRA VIDA')) return 'vida';
  return null;
}

const MINUTES = /^\((\d+)\s*mins?\.?\)\s*(.*)$/i;

function kindOf(section: WorkbookSection, number: number | null, title: string, note: string): WorkbookPartKind {
  if (section === 'tesoros') {
    if (/perlas escondidas/i.test(title)) return 'perlas';
    if (/lectura de la biblia/i.test(title)) return 'lectura';
    return 'tesoros';
  }
  if (section === 'vida') return /estudio b[ií]blico de la congregaci[oó]n/i.test(title) ? 'estudio' : 'parte';
  if (section === 'maestros') {
    if (/^an[aá]lisis con el auditorio/i.test(note)) return 'analisis';
    if (/^discurso\b/i.test(title)) return 'discurso';
    return 'estudiante';
  }
  return number === null ? 'intro' : 'parte';
}

/**
 * Parse one week file. Returns null for files that are not a week (cover, index).
 *
 * Shape (2026 workbook): <header><h1>12-18 DE OCTUBRE</h1><h2>JEREMÍAS 42-44</h2></header>, then
 * in .bodyTxt: an h3 "Canción N y oración | Palabras de introducción (1 min.)", an h2 per section,
 * an h3 "N. Título" per part followed by a <p>"(N mins.) …"</p>, an h3 "Canción N" opening
 * Nuestra vida cristiana and a last h3 "Palabras de conclusión (3 mins.) | Canción N y oración".
 */
export function parseWeekXhtml(xhtml: string, issue: Issue): WorkbookWeek | null {
  const doc = new DOMParser().parseFromString(xhtml, 'text/html');
  const label = clean(doc.querySelector('header h1')?.textContent ?? doc.querySelector('h1')?.textContent);
  const weekStart = weekStartFromLabel(label, issue);
  const body = doc.querySelector('.bodyTxt');
  if (!weekStart || !body) return null;

  const bibleReading = clean(doc.querySelector('header h2')?.textContent);
  const songs: WorkbookWeek['songs'] = [null, null, null];
  const parts: WorkbookPart[] = [];
  let section: WorkbookSection = 'inicio';
  let pending: { number: number; title: string } | null = null;

  const flush = (minutes: number, note: string) => {
    if (!pending) return;
    parts.push({
      section,
      number: pending.number,
      title: pending.title,
      minutes,
      kind: kindOf(section, pending.number, pending.title, note),
    });
    pending = null;
  };

  for (const el of body.querySelectorAll('h2, h3, p')) {
    const tag = el.tagName.toLowerCase();
    const text = clean(el.textContent);
    if (!text) continue;

    if (tag === 'p') {
      const m = MINUTES.exec(text);
      if (pending && m) flush(Number(m[1]), m[2] ?? '');
      continue;
    }
    // A numbered part without a minutes paragraph still counts (0 min, editable later).
    if (pending) flush(0, '');

    if (tag === 'h2') {
      section = sectionOf(text) ?? section;
      continue;
    }

    const numbered = /^(\d+)\.\s*(.+)$/.exec(text);
    if (numbered) {
      pending = { number: Number(numbered[1]), title: clean(numbered[2]) };
      continue;
    }

    // Unnumbered h3: songs and the opening/closing words, possibly joined with "|".
    for (const seg of text.split('|').map(clean)) {
      const song = /^Canci[oó]n\s+(\d+)/i.exec(seg);
      if (song) {
        const n = Number(song[1]);
        if (section === 'inicio') songs[0] = n;
        else if (/oraci[oó]n/i.test(seg) || songs[1] !== null) songs[2] = n;
        else songs[1] = n;
        continue;
      }
      const words = /^(Palabras de (introducci[oó]n|conclusi[oó]n))\s*(?:\((\d+)\s*mins?\.?\))?/i.exec(seg);
      if (words) {
        const intro = /introducci/i.test(words[2] ?? '');
        parts.push({
          section: intro ? 'inicio' : section,
          number: null,
          title: intro ? 'Palabras de introducción' : 'Palabras de conclusión',
          minutes: Number(words[3] ?? (intro ? 1 : 3)),
          kind: intro ? 'intro' : 'conclusion',
        });
      }
    }
  }
  if (pending) flush(0, '');

  return parts.length ? { weekStart, label, bibleReading, songs, parts } : null;
}
