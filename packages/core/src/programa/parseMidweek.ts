import type { MidweekPart, MidweekSection, MidweekWeek, PdfItem, ProgramaPerson } from './types';
import { groupLines, isoDate, joinItems, normalizeName, yearForMonth } from './text';

// "Reunión de entre semana" (PDF "Programa <mes> <año>"). Cada semana empieza con
// "MAR.." + "dd.mm." en la columna izquierda. Se lee por coordenadas, no por orden de texto.

const DATE_RE = /^\d{2}\.\d{2}\.$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const ROLE_RE = /^(Presidente|Lector|Conductor)$/;
const SECTION_RE: Array<[RegExp, MidweekSection]> = [
  [/^TESOROS DE LA BIBLIA/, 'tesoros'],
  [/^SEAMOS MEJORES MAESTROS/, 'maestros'],
  [/^NUESTRA VIDA CRISTIANA/, 'vida'],
];

// Distancia vertical desde la fecha hasta la fila "MAR.." que la encabeza.
const MAR_OFFSET = 15.8;

interface Anchor {
  time: string;
  y: number;
}

export function parseMidweekPages(pages: PdfItem[][], year: number): MidweekWeek[] {
  const first = pages[0] ? midweekDates(pages[0])[0] : undefined;
  const refMonth = first ? Number(first.str.trim().split('.')[1]) : 1;
  const weeks: MidweekWeek[] = [];
  for (const page of pages) {
    weeks.push(...parseMidweekPage(page, year, refMonth));
  }
  return weeks;
}

// Cabeceras de semana de la página, de arriba hacia abajo.
function midweekDates(items: PdfItem[]): PdfItem[] {
  return items
    .filter((it) => it.x < 60 && DATE_RE.test(it.str.trim()))
    .sort((a, b) => b.y - a.y);
}

function parseMidweekPage(items: PdfItem[], year: number, refMonth: number): MidweekWeek[] {
  const dateItems = midweekDates(items);

  const weeks: MidweekWeek[] = [];
  dateItems.forEach((dateItem, i) => {
    const top = dateItem.y + MAR_OFFSET;
    const next = dateItems[i + 1];
    const nextTop = next ? next.y + MAR_OFFSET : -Infinity;
    // Filas de la semana: entre su cabecera y la siguiente (ignora la cabecera de la semana siguiente).
    const weekItems = items.filter((it) => it.x >= 60 && it.y <= top + 2 && it.y > nextTop + 3);
    const [dd = NaN, mm = NaN] = dateItem.str.trim().split('.').map(Number);
    weeks.push(buildWeek(weekItems, isoDate(yearForMonth(year, mm, refMonth), mm, dd)));
  });
  return weeks;
}

function buildWeek(items: PdfItem[], date: string): MidweekWeek {
  const asambleaLine = groupLines(items.filter((it) => it.x >= 100)).find((l) => /^ASAMBLEA/.test(l.text));
  const asamblea = asambleaLine ? asambleaLine.text : null;

  const sections = items
    .filter((it) => it.x >= 100 && it.x < 140)
    .map((it) => {
      const hit = SECTION_RE.find(([re]) => re.test(it.str));
      return hit ? { y: it.y, key: hit[1] } : null;
    })
    .filter((s): s is { y: number; key: MidweekSection } => s !== null)
    .sort((a, b) => b.y - a.y);

  const anchors: Anchor[] = items
    .filter((it) => it.x >= 60 && it.x < 80 && TIME_RE.test(it.str.trim()))
    .map((it) => ({ time: it.str.trim(), y: it.y }))
    .sort((a, b) => b.y - a.y);

  if (anchors.length === 0) return { date, asamblea, parts: [] };

  const people = items.filter((it) => it.x >= 370 && !ROLE_RE.test(it.str.trim()) && !/^ASAMBLEA/.test(it.str));
  const roles = items.filter((it) => it.x >= 370 && ROLE_RE.test(it.str.trim()));

  // Cada persona va a la fila (anchor) más cercana en vertical.
  const byAnchor = new Map<number, ProgramaPerson[]>();
  const personPos = new Map<PdfItem, { anchorIdx: number }>();
  for (const p of people) {
    const idx = nearestIndex(anchors, p.y);
    const list = byAnchor.get(idx) ?? [];
    list.push({ name: normalizeName(p.str) });
    byAnchor.set(idx, list);
    personPos.set(p, { anchorIdx: idx });
  }

  // Cada rol va debajo de la fila de nombres que le corresponde. En una fila con dos nombres
  // y dos roles (Lector / Conductor) se empareja por orden de izquierda a derecha: la distancia
  // horizontal no sirve porque el rol siempre cae entre los dos nombres.
  const rows = clusterRows(people);
  for (const row of rows) {
    const rowRoles = roles
      .filter((r) => row.y - r.y > 0 && row.y - r.y <= 14)
      .sort((a, b) => a.x - b.x);
    const rowPeople = [...row.items].sort((a, b) => a.x - b.x);
    rowRoles.forEach((r, i) => {
      const person = rowPeople.length === rowRoles.length
        ? rowPeople[i]
        : rowPeople.reduce((a, b) => (Math.abs(b.x - r.x) < Math.abs(a.x - r.x) ? b : a));
      if (!person) return;
      const idx = personPos.get(person)?.anchorIdx;
      if (idx === undefined) return;
      const entry = (byAnchor.get(idx) ?? []).find((q) => q.name === normalizeName(person.str));
      if (entry) entry.role = r.str.trim();
    });
  }

  const parts: MidweekPart[] = anchors.map((a, idx) => {
    const title = joinItems(
      items
        .filter((it) => it.x >= 100 && it.x < 370 && Math.abs(it.y - a.y) <= 4)
        .sort((p, q) => p.x - q.x)
    );
    const section = sectionAbove(sections, a.y);
    return { time: a.time, title, section, people: byAnchor.get(idx) ?? [] };
  });

  return { date, asamblea, parts };
}

// Agrupa nombres que comparten fila (misma y ± 2).
function clusterRows(items: PdfItem[]): Array<{ y: number; items: PdfItem[] }> {
  const rows: Array<{ y: number; items: PdfItem[] }> = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2) last.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  return rows;
}

function nearestIndex(anchors: Anchor[], y: number): number {
  let best = 0;
  for (let i = 1; i < anchors.length; i++) {
    const cur = anchors[i];
    const top = anchors[best];
    if (cur && top && Math.abs(cur.y - y) < Math.abs(top.y - y)) best = i;
  }
  return best;
}

// Sección vigente: la cabecera más cercana por encima de la fila (y mayor). Sin cabecera → "inicio".
function sectionAbove(sections: Array<{ y: number; key: MidweekSection }>, y: number): MidweekSection {
  const above = sections.filter((s) => s.y > y).sort((a, b) => a.y - b.y);
  return above[0]?.key ?? 'inicio';
}
