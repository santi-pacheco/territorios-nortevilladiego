/**
 * Gestión · Programa preview model. Pure: no React, no pdf.js. Takes the text items read
 * from each uploaded PDF, detects its kind, runs the core parsers and builds everything the
 * preview shows before publishing: every meeting, its warnings, whether it replaces a
 * published row, grouped by Mon–Sun week.
 */
import {
  parseMidweekPages,
  parseWeekendPages,
  type MidweekWeek,
  type PdfItem,
  type WeekendMeeting,
} from '@territorios/core';
import type { ProgramKind, ProgramWeekRow } from '@territorios/data';
import { addDaysIso, fromIso, mondayOf } from '../../../lib/week';

export interface StagedFile {
  name: string;
  pages: PdfItem[][];
}

export type PreviewMeeting =
  | { kind: 'midweek'; week: MidweekWeek }
  | { kind: 'weekend'; week: WeekendMeeting };

export interface PreviewEntry {
  /** `${kind}:${date}`, unique inside a preview. */
  key: string;
  kind: ProgramKind;
  date: string;
  /** Monday of the program week (the optimistic target of updateProgramWeek). */
  weekStart: string;
  meeting: PreviewMeeting;
  fileName: string;
  /** Things the editor should look at; publishing is still allowed. */
  warnings: string[];
  /** Set when the row cannot be published at all (the DB would reject it). */
  blocking: string | null;
  /** The published row this entry would overwrite. */
  existing: ProgramWeekRow | null;
}

export interface PreviewFile {
  name: string;
  kind: ProgramKind | null;
  count: number;
  error: string | null;
}

export interface PreviewGroup {
  weekStart: string;
  entries: PreviewEntry[];
}

export interface Preview {
  files: PreviewFile[];
  groups: PreviewGroup[];
  entries: PreviewEntry[];
}

export const KIND_LABEL: Record<ProgramKind, string> = {
  midweek: 'Entre semana',
  weekend: 'Fin de semana',
};

const KEY_DOW: Record<ProgramKind, number> = { midweek: 2, weekend: 6 };

/** Same rule as v1 UploadPanel: "ENTRE SEMANA" wins, then "fin de semana" / "ATALAYA". */
export function detectKind(pages: PdfItem[][]): ProgramKind | null {
  const text = pages
    .flat()
    .map((it) => it.str)
    .join(' ');
  if (/ENTRE SEMANA/i.test(text)) return 'midweek';
  if (/fin de semana|ATALAYA/i.test(text)) return 'weekend';
  return null;
}

// Parts that never carry a name on the printed programme.
const UNASSIGNED_OK = /^(Canción \d+|Palabras de conclusión)$/i;

export function midweekWarnings(w: MidweekWeek): string[] {
  if (w.asamblea) return [];
  if (w.parts.length === 0) return ['Sin partes: revisá que el PDF sea el programa del mes.'];
  const out: string[] = [];
  if (!w.parts.some((p) => p.people.some((q) => q.role === 'Presidente'))) {
    out.push('Sin presidente.');
  }
  for (const p of w.parts) {
    if (p.people.length === 0 && !UNASSIGNED_OK.test(p.title.trim())) {
      out.push(`${p.time} ${p.title}: sin asignar.`);
    }
  }
  return out;
}

export function weekendWarnings(m: WeekendMeeting): string[] {
  if (m.asamblea) return [];
  const out: string[] = [];
  if (!m.presidente) out.push('Sin presidente.');
  if (!m.discurso) out.push('Sin discurso.');
  else if (!m.discurso.orador) out.push('Discurso sin orador.');
  if (!m.conductor) out.push('Estudio de La Atalaya sin conductor.');
  if (!m.lector) out.push('Estudio de La Atalaya sin lector.');
  if (!m.oracionFinal) out.push('Sin oración final.');
  return out;
}

function parseFile(file: StagedFile, year: number): { kind: ProgramKind | null; meetings: PreviewMeeting[] } {
  const kind = detectKind(file.pages);
  if (kind === 'midweek') {
    return { kind, meetings: parseMidweekPages(file.pages, year).map((week) => ({ kind, week })) };
  }
  if (kind === 'weekend') {
    return { kind, meetings: parseWeekendPages(file.pages, year).map((week) => ({ kind, week })) };
  }
  return { kind: null, meetings: [] };
}

export function buildPreview(
  files: readonly StagedFile[],
  year: number,
  published: readonly ProgramWeekRow[],
): Preview {
  const publishedByKey = new Map(published.map((r) => [`${r.kind}:${r.date}`, r]));
  const byKey = new Map<string, PreviewEntry>();
  const previewFiles: PreviewFile[] = [];

  for (const file of files) {
    const { kind, meetings } = parseFile(file, year);
    previewFiles.push({
      name: file.name,
      kind,
      count: meetings.length,
      error:
        kind === null
          ? 'No es un programa de entre semana ni de fin de semana.'
          : meetings.length === 0
            ? 'No encontramos ninguna fecha en este PDF.'
            : null,
    });

    for (const meeting of meetings) {
      const date = meeting.week.date;
      const key = `${meeting.kind}:${date}`;
      const warnings =
        meeting.kind === 'midweek' ? midweekWarnings(meeting.week) : weekendWarnings(meeting.week);
      const prev = byKey.get(key);
      if (prev) {
        warnings.unshift(`También está en ${prev.fileName}; se usa la de ${file.name}.`);
      }
      const dow = fromIso(date).getDay();
      byKey.set(key, {
        key,
        kind: meeting.kind,
        date,
        weekStart: mondayOf(fromIso(date)),
        meeting,
        fileName: file.name,
        warnings,
        blocking: Number.isNaN(dow)
          ? 'Fecha ilegible.'
          : dow !== KEY_DOW[meeting.kind]
            ? `La fecha no cae ${meeting.kind === 'midweek' ? 'martes' : 'sábado'}: revisá el año.`
            : null,
        existing: publishedByKey.get(key) ?? null,
      });
    }
  }

  const entries = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind),
  );
  const groups: PreviewGroup[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.weekStart === e.weekStart) last.entries.push(e);
    else groups.push({ weekStart: e.weekStart, entries: [e] });
  }
  return { files: previewFiles, groups, entries };
}

/** Entries that start ticked: everything publishable. */
export function defaultSelection(preview: Preview): Set<string> {
  return new Set(preview.entries.filter((e) => !e.blocking).map((e) => e.key));
}

export type PublishStep =
  | { op: 'create'; entry: PreviewEntry }
  | { op: 'update'; entry: PreviewEntry; row: ProgramWeekRow };

/** Upsert plan: insert new (kind, date) keys, CAS-update the ones already published. */
export function publishPlan(preview: Preview, selected: ReadonlySet<string>): PublishStep[] {
  return preview.entries
    .filter((e) => selected.has(e.key) && !e.blocking)
    .map((entry) =>
      entry.existing ? { op: 'update', entry, row: entry.existing } : { op: 'create', entry },
    );
}

/** "6 – 12 oct" style range for a week header. */
export function weekRange(weekStart: string): string {
  const s = fromIso(weekStart);
  const e = fromIso(addDaysIso(weekStart, 6));
  const month = (d: Date) => MONTHS_SHORT[d.getMonth()];
  return s.getMonth() === e.getMonth()
    ? `${s.getDate()} – ${e.getDate()} ${month(e)} ${e.getFullYear()}`
    : `${s.getDate()} ${month(s)} – ${e.getDate()} ${month(e)} ${e.getFullYear()}`;
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAY_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** "Martes 13 oct" */
export function meetingDay(date: string): string {
  const d = fromIso(date);
  return `${DAY_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** One-line summary of a published row for the "Publicado" list. */
export function publishedSummary(row: ProgramWeekRow): string {
  const d = row.data;
  if (typeof d.asamblea === 'string' && d.asamblea) return d.asamblea;
  if (row.kind === 'midweek') {
    const n = Array.isArray(d.parts) ? d.parts.length : 0;
    return n === 1 ? '1 parte' : `${n} partes`;
  }
  const disc = d.discurso as { titulo?: unknown } | null | undefined;
  return typeof disc?.titulo === 'string' && disc.titulo ? disc.titulo : 'Sin discurso';
}
