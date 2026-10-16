import type { PdfItem, WeekendDiscourse, WeekendMeeting } from './types';
import { cleanTitle, groupLines, isoDate, joinItems, monthNumber, normalizeName, yearForMonth } from './text';

// "Reunión del fin de semana" (PDF "RP <mes> <año>"). Es una cuadrícula 2×2 hecha en Word:
// el texto NO sale en orden de lectura. Se separa por columna (x) y por cabecera de fecha (y).

const COLUMN_SPLIT_X = 297;
const HEADER_RE = /^(\d+)?\s*DE\s+([A-ZÁÉÍÓÚ]+)$/;

interface Header {
  day: number;
  month: number;
  x: number;
  y: number;
}

export function parseWeekendPages(pages: PdfItem[][], year: number): WeekendMeeting[] {
  const refMonth = pages.flatMap((p) => findHeaders(p))[0]?.month ?? 1;
  const meetings: WeekendMeeting[] = [];
  for (const page of pages) {
    const headers = findHeaders(page);
    for (const h of headers) {
      const col = h.x < COLUMN_SPLIT_X ? 'L' : 'R';
      const below = headers
        .filter((o) => (o.x < COLUMN_SPLIT_X ? 'L' : 'R') === col && o.y < h.y)
        .sort((a, b) => b.y - a.y)[0];
      const bottom = below ? below.y : -Infinity;
      const blockItems = page.filter(
        (it) => (it.x < COLUMN_SPLIT_X ? 'L' : 'R') === col && it.y < h.y - 2 && it.y > bottom
      );
      const date = isoDate(yearForMonth(year, h.month, refMonth), h.month, h.day);
      meetings.push(parseBlock(blockItems, date));
    }
  }
  return meetings.sort((a, b) => a.date.localeCompare(b.date));
}

// Cabeceras "3 DE OCTUBRE". Los días de dos cifras llegan partidos: "1" + "7 DE OCTUBRE".
function findHeaders(items: PdfItem[]): Header[] {
  const out: Header[] = [];
  for (const it of items) {
    const text = it.str.trim();
    const m = text.match(HEADER_RE);
    if (!m) continue;
    let day = m[1];
    if (!day) continue;
    const left = items.find(
      (o) => /^\d$/.test(o.str.trim()) && Math.abs(o.y - it.y) <= 1 && o.x < it.x && it.x - o.x < 10
    );
    if (left) day = left.str.trim() + day;
    const month = m[2] ? monthNumber(m[2]) : null;
    if (!month) continue;
    out.push({ day: Number(day), month, x: it.x, y: it.y });
  }
  return out;
}

function parseBlock(items: PdfItem[], date: string): WeekendMeeting {
  const lines = groupLines(items);

  const asambleaLine = lines.find((l) => /ASAMBLEA/.test(l.text));
  const asamblea = asambleaLine ? asambleaLine.text : null;

  const presidenteLine = lines.find((l) => /^Presidente\b/.test(l.text));
  const presidente = presidenteLine ? valueAfter(presidenteLine.text, /^Presidente\s*/) : null;

  const songs: string[] = [];
  for (const l of lines) {
    for (const m of l.text.matchAll(/Canción\s*(\d+)/g)) if (m[1]) songs.push(m[1]);
  }

  const oracionLine = lines.find((l) => /Oración conclusión/.test(l.text));
  const oracionFinal = oracionLine ? valueAfter(oracionLine.text, /^.*?Oración conclusión\s*/) : null;

  const { conductor, lector } = findConductorLector(items);

  const discurso = parseDiscurso(lines);

  return {
    date,
    asamblea,
    presidente,
    cancionInicio: songs[0] ?? null,
    conductor,
    lector,
    cancionFin: songs.length > 1 ? (songs[songs.length - 1] ?? null) : null,
    oracionFinal,
    discurso,
  };
}

function valueAfter(text: string, label: RegExp): string | null {
  const v = normalizeName(text.replace(label, ''));
  return v || null;
}

// Los nombres van justo debajo de las etiquetas "Conductor" y "Lector" (≈16 pts más abajo).
function findConductorLector(items: PdfItem[]): { conductor: string | null; lector: string | null } {
  const cLabel = items.find((it) => it.str.trim() === 'Conductor');
  const lLabel = items.find((it) => it.str.trim() === 'Lector');
  if (!cLabel || !lLabel) return { conductor: null, lector: null };

  const labelY = cLabel.y;
  const mid = (cLabel.x + lLabel.x) / 2;
  const values = items
    .filter((it) => it.y < labelY - 10 && it.y > labelY - 19 && !/^(Conductor|Lector)$/.test(it.str.trim()))
    .sort((a, b) => a.x - b.x);

  const conductorItems = values.filter((it) => it.x < mid);
  const lectorItems = values.filter((it) => it.x >= mid);
  return {
    conductor: joinItems(conductorItems) || null,
    lector: joinItems(lectorItems) || null,
  };
}

function parseDiscurso(lines: ReturnType<typeof groupLines>): WeekendDiscourse | null {
  const tipoLine = lines.find((l) => /^(PÚBLICO|ESPECIAL)\b/.test(l.text));
  const asambleaLine = lines.find((l) => /ASAMBLEA/.test(l.text));
  const start = tipoLine ?? asambleaLine;
  if (!start) return null;

  const reunion = lines.find((l) => /^REUNIÓN\b/.test(l.text));
  const speakerLine = lines.find((l) => /^.+?\s*[–-]\s*Congre\b/.test(l.text));
  const bottom = speakerLine?.y ?? reunion?.y ?? -Infinity;

  const titulo = cleanTitle(
    lines
      .filter((l) => l.y < start.y - 2 && l.y > bottom + 2)
      .filter((l) => !/Canción|PÚBLICO|ESPECIAL|DISCURSO|ASAMBLEA|Discursante/.test(l.text))
      .map((l) => l.text)
      .join(' ')
  );

  let orador: string | null = null;
  let congregacion: string | null = null;
  let saliente: string | null = null;
  if (speakerLine) {
    const m = speakerLine.text.match(/^(.+?)\s*[–-]\s*Congre\s+(.+)$/);
    if (m?.[1] && m[2]) {
      orador = normalizeName(m[1]);
      congregacion = m[2].trim();
    }
    if (reunion) {
      const text = lines
        .filter((l) => l.y < speakerLine.y - 2 && l.y > reunion.y + 2)
        .map((l) => l.text)
        .join(' ')
        .replace(/Discursante\s+Saliente:?/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      saliente = text || null;
    }
  }

  if (!titulo && !orador) return null;
  return {
    tipo: tipoLine && /^ESPECIAL/.test(tipoLine.text) ? 'ESPECIAL' : 'PÚBLICO',
    titulo,
    orador,
    congregacion,
    saliente,
  };
}
