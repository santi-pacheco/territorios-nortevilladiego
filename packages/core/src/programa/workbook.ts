// Guía de actividades (JW.org, pub=mwb) → semana de entre semana editable.
//
// La Edge Function `workbook` devuelve solo la estructura de cada semana (títulos, minutos,
// secciones y canciones). Este módulo la convierte en un MidweekWeek con horarios calculados y
// lugares vacíos para los nombres, con los mismos títulos, horarios y roles que el programa impreso.
// El tipo WorkbookWeek está duplicado en supabase/functions/workbook/lib.ts (la función se
// despliega sola y no importa del monorepo): mantener ambos iguales.
import type { MidweekPart, MidweekSection, MidweekWeek, ProgramaPerson } from './types';
import { addDays } from './week';

export type WorkbookPartKind =
  | 'intro' // Palabras de introducción
  | 'tesoros' // primer discurso de Tesoros
  | 'perlas' // Busquemos perlas escondidas
  | 'lectura' // Lectura de la Biblia (estudiante)
  | 'estudiante' // Seamos mejores maestros: estudiante + ayudante
  | 'discurso' // Seamos mejores maestros: discurso de un estudiante
  | 'analisis' // "Análisis con el auditorio": un hermano, sin consejo
  | 'parte' // Nuestra vida cristiana
  | 'estudio' // Estudio bíblico de la congregación
  | 'conclusion'; // Palabras de conclusión

export interface WorkbookPart {
  section: MidweekSection;
  number: number | null;
  title: string;
  minutes: number;
  kind: WorkbookPartKind;
}

export interface WorkbookWeek {
  weekStart: string; // lunes ISO
  label: string; // "12-18 DE OCTUBRE"
  bibleReading: string; // "JEREMÍAS 42-44"
  songs: [number | null, number | null, number | null]; // inicio, medio, cierre
  parts: WorkbookPart[];
}

// Duraciones que usa el programa impreso.
const SONG_AND_PRAYER = 5; // canción + oración de inicio / de cierre
const MIDDLE_SONG = 5;
const COUNSEL = 1; // consejo después de cada asignación de estudiante
const BEFORE_READING = 1; // el impreso deja un minuto entre Perlas y la Lectura

function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`Hora inválida: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function hhmm(total: number): string {
  const h = Math.floor(total / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const blank = (role?: string): ProgramaPerson => (role ? { name: '', role } : { name: '' });

function songTitle(n: number | null, withPrayer: boolean): string {
  const song = n === null ? 'Canción' : `Canción ${n}`;
  return withPrayer ? `${song} & Oración` : song;
}

/** Lugares para nombres según el tipo de parte (como en el programa impreso). */
function slotsFor(kind: WorkbookPartKind): ProgramaPerson[] {
  switch (kind) {
    case 'intro':
      return [blank('Presidente')];
    case 'estudiante':
      return [blank(), blank()];
    case 'estudio':
      return [blank('Lector'), blank('Conductor')];
    case 'conclusion':
      return [];
    default:
      return [blank()];
  }
}

/**
 * Convierte una semana de la Guía en el formato del programa: canciones como partes
 * ("Canción 103 & Oración"), horario de cada parte desde `start` y personas vacías con sus roles.
 *
 * Horarios: canción + oración 5 min, introducción según la Guía, la Lectura empieza un minuto
 * después de Perlas, cada asignación de estudiante (Lectura y Seamos mejores maestros salvo
 * "Análisis con el auditorio") suma 1 min de consejo, la canción del medio 5 min.
 */
export function workbookWeekToMidweek(
  week: WorkbookWeek,
  opts: { start?: string } = {},
): MidweekWeek {
  let t = toMinutes(opts.start ?? '19:00');
  const parts: MidweekPart[] = [];
  const push = (section: MidweekSection, title: string, people: ProgramaPerson[]) =>
    parts.push({ time: hhmm(t), title, section, people });

  push('inicio', songTitle(week.songs[0], true), [blank()]);
  t += SONG_AND_PRAYER;

  let middleSong = false;
  const addMiddleSong = () => {
    if (middleSong) return;
    middleSong = true;
    push('vida', songTitle(week.songs[1], false), []);
    t += MIDDLE_SONG;
  };

  for (const p of week.parts) {
    if (p.section === 'vida' || p.kind === 'conclusion') addMiddleSong();
    if (p.kind === 'lectura') t += BEFORE_READING;
    push(p.kind === 'conclusion' ? 'vida' : p.section, p.title, slotsFor(p.kind));
    t += p.minutes;
    if (p.kind === 'lectura' || p.kind === 'estudiante' || p.kind === 'discurso') t += COUNSEL;
  }
  addMiddleSong();

  push('vida', songTitle(week.songs[2], true), [blank()]);

  return { date: addDays(week.weekStart, 1), asamblea: null, parts };
}
