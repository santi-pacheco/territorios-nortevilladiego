// Saneado de PdfItem[][] de los programas: cambia nombres de personas por "Persona NN"
// y congregaciones por "Congregación Ejemplo", conservando títulos, fechas, secciones,
// roles, posiciones x/y y la cantidad de fragmentos.
//
// La lista de nombres NO está escrita en ningún lado: se arma en tiempo de ejecución a
// partir de lo que los propios parsers leen del PDF real.
import { readPdfPages } from './extract-pdf-items.mjs';
import { parseMidweekPages } from '../../packages/core/src/programa/parseMidweek';
import { parseWeekendPages } from '../../packages/core/src/programa/parseWeekend';
import { groupLines } from '../../packages/core/src/programa/text';
import type { MidweekWeek, PdfItem, WeekendMeeting } from '../../packages/core/src/programa/types';

export interface Parsed {
  midweek: MidweekWeek[];
  weekend: WeekendMeeting[];
}

export interface Source {
  midweekPages: PdfItem[][];
  weekendPages: PdfItem[][];
  parsed: Parsed;
}

interface Target {
  kind: 'person' | 'place';
  norms: string[];
  fake: string; // sólo personas; los lugares dependen del contexto
}

export async function loadSource(midweekPdf: string, weekendPdf: string, year: number): Promise<Source> {
  const { readFile } = await import('node:fs/promises');
  const midweekPages = (await readPdfPages(await readFile(midweekPdf))) as PdfItem[][];
  const weekendPages = (await readPdfPages(await readFile(weekendPdf))) as PdfItem[][];
  return { midweekPages, weekendPages, parsed: parse(midweekPages, weekendPages, year) };
}

export function parse(midweekPages: PdfItem[][], weekendPages: PdfItem[][], year: number): Parsed {
  return { midweek: parseMidweekPages(midweekPages, year), weekend: parseWeekendPages(weekendPages, year) };
}

// Sin tildes, minúsculas y sin puntuación pegada: "Canción," == "cancion".
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^[,.;:()“”"]+|[,.;:()“”"]+$/g, '');
}

export function tokens(s: string): string[] {
  return s.split(/[\s,–-]+/).map(norm).filter(Boolean);
}

const DASH_RE = /\s*[–-]\s*/;

// Nombres de personas y lugares tal como los leen los parsers, en orden de aparición.
export function collectNames(src: Source): { people: string[]; places: string[] } {
  const people: string[] = [];
  const places: string[] = [];
  for (const w of src.parsed.midweek) {
    for (const part of w.parts) for (const p of part.people) people.push(p.name);
  }
  for (const m of src.parsed.weekend) {
    for (const v of [m.presidente, m.conductor, m.lector, m.oracionFinal, m.discurso?.orador]) if (v) people.push(v);
    const saliente = m.discurso?.saliente;
    if (saliente) {
      const [who, where] = saliente.split(DASH_RE);
      if (who) people.push(who);
      if (where) places.push(where);
    }
    if (m.discurso?.congregacion) places.push(m.discurso.congregacion);
    const sede = m.asamblea?.match(/ASAMBLEA\s+REGIONAL\s+(.+?)\s+\d{4}/);
    if (sede?.[1]) places.push(sede[1]);
  }
  // Cabecera del programa de entre semana: "Congregación NOMBRE".
  for (const page of src.midweekPages) {
    for (const it of page) {
      const m = it.str.trim().match(/^Congregación\s+(.+)$/i);
      if (m?.[1]) places.push(m[1]);
    }
  }
  return { people, places };
}

export function buildTargets(src: Source): Target[] {
  const { people, places } = collectNames(src);
  const byKey = new Map<string, Target>();
  let n = 0;
  for (const name of people) {
    const norms = tokens(name);
    const key = norms.join(' ');
    if (!norms.length || byKey.has(key)) continue;
    n++;
    byKey.set(key, { kind: 'person', norms, fake: `Persona ${String(n).padStart(2, '0')}` });
  }
  for (const name of places) {
    const norms = tokens(name);
    const key = norms.join(' ');
    if (!norms.length || byKey.has(key)) continue;
    byKey.set(key, { kind: 'place', norms, fake: '' });
  }
  // Primero los más largos para que un nombre corto no pise uno compuesto.
  return [...byKey.values()].sort((a, b) => b.norms.length - a.norms.length);
}

interface Tok {
  item: PdfItem;
  start: number;
  end: number;
  norm: string;
  used: boolean;
}

interface EditOp {
  start: number;
  end: number;
  repl: string;
}

function placeFake(toks: Tok[], i: number, original: string): string {
  const prev = toks[i - 1]?.norm;
  const inAsamblea = toks.some((t) => t.norm === 'asamblea');
  let fake = prev === 'congregacion' ? 'Ejemplo' : inAsamblea ? 'Ciudad Ejemplo' : 'Congregación Ejemplo';
  if (original === original.toUpperCase()) fake = fake.toUpperCase();
  return fake;
}

// Reemplaza en una línea (fragmentos ordenados por x). Un nombre partido en varios
// fragmentos ("Nombre" + "Apellido") se reparte palabra por palabra en esos mismos fragmentos.
function sanitizeLine(items: PdfItem[], targets: Target[]): void {
  const toks: Tok[] = [];
  for (const item of items) {
    for (const m of item.str.matchAll(/\S+/g)) {
      const n = norm(m[0]);
      if (!n) continue;
      toks.push({ item, start: m.index, end: m.index + m[0].length, norm: n, used: false });
    }
  }
  const edits = new Map<PdfItem, EditOp[]>();
  for (const t of targets) {
    const len = t.norms.length;
    for (let i = 0; i + len <= toks.length; i++) {
      const span = toks.slice(i, i + len);
      if (span.some((s, k) => s.used || s.norm !== t.norms[k])) continue;
      const groups: Tok[][] = [];
      for (const s of span) {
        const last = groups[groups.length - 1];
        if (last && last[0]!.item === s.item) last.push(s);
        else groups.push([s]);
      }
      const original = span.map((s) => s.item.str.slice(s.start, s.end)).join(' ');
      const fake = t.kind === 'person' ? t.fake : placeFake(toks, i, original);
      const words = fake.split(' ');
      if (groups.length > words.length) throw new Error(`Nombre partido en ${groups.length} fragmentos: no se puede sanear`);
      groups.forEach((g, gi) => {
        const repl = gi < groups.length - 1 ? words[gi]! : words.slice(gi).join(' ');
        const first = g[0]!;
        const last = g[g.length - 1]!;
        const list = edits.get(first.item) ?? [];
        list.push({ start: first.start, end: last.end, repl });
        edits.set(first.item, list);
      });
      for (const s of span) s.used = true;
      i += len - 1;
    }
  }
  for (const [item, list] of edits) {
    const before = item.str;
    let str = before;
    for (const e of [...list].sort((a, b) => b.start - a.start)) str = str.slice(0, e.start) + e.repl + str.slice(e.end);
    item.str = str;
    // Sólo se achica: si el ancho creciera, el hueco con el fragmento siguiente
    // desaparecería y joinItems pegaría las palabras.
    item.w = item.w * Math.min(1, str.length / before.length);
  }
}

export function sanitizePages(pages: PdfItem[][], targets: Target[]): PdfItem[][] {
  return pages.map((page) => {
    const copy = page.map((it) => ({ ...it }));
    for (const line of groupLines(copy, 1)) sanitizeLine(line.items, targets);
    return copy;
  });
}

export function sanitizeString(s: string, targets: Target[]): string {
  const item: PdfItem = { str: s, x: 0, y: 0, w: s.length, font: '' };
  sanitizeLine([item], targets);
  return item.str;
}

export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)])) as T;
  }
  return value;
}
