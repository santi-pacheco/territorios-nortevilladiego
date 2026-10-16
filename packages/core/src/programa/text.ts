import type { PdfItem } from './types';

export interface Line {
  y: number;
  items: PdfItem[]; // ordenados de izquierda a derecha
  text: string;
}

// Une fragmentos de una misma línea. El PDF parte palabras a veces ("Ha enc" + "ontrado"),
// así que sólo se pone espacio cuando hay un hueco real entre fragmentos.
export function joinItems(items: PdfItem[]): string {
  let out = '';
  let prev: PdfItem | null = null;
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const spaced = /\s$/.test(out) || /^\s/.test(it.str);
      out += spaced || gap >= 1 ? ' ' : '';
    }
    out += it.str;
    prev = it;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Agrupa fragmentos por línea (misma y ± tol), de arriba hacia abajo.
export function groupLines(items: PdfItem[], tol = 2.5): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= tol) {
      last.items.push(it);
    } else {
      lines.push({ y: it.y, items: [it], text: '' });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = joinItems(l.items);
  }
  return lines;
}

// Quita comillas tipográficas y las variantes mal colocadas por el PDF.
export function cleanTitle(s: string): string {
  return s.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
}

// "Apellido,Nombre Dos" -> "Apellido, Nombre Dos"
export function normalizeName(s: string): string {
  return s.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const MESES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

// Un PDF de diciembre puede traer fechas de enero del año siguiente (y viceversa).
// Se toma el mes de referencia del archivo y se corre el año si la distancia supera 6 meses.
export function yearForMonth(baseYear: number, month: number, refMonth: number): number {
  if (refMonth - month > 6) return baseYear + 1;
  if (month - refMonth > 6) return baseYear - 1;
  return baseYear;
}

export function monthNumber(name: string): number | null {
  const up = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  const idx = MESES.indexOf(up);
  return idx >= 0 ? idx + 1 : null;
}
