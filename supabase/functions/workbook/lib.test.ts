// deno test --config supabase/functions/workbook/deno.json supabase/functions/workbook
// The XHTML below copies the markup shape of a 2026 workbook week file (header h1/h2, .bodyTxt,
// section h2s, numbered h3s, "(N mins.)" paragraphs) with invented titles and text.
import { assertEquals } from 'jsr:@std/assert@1.0.13';
import {
  isWeekFile,
  issueForWeek,
  parseWeekXhtml,
  shiftIssue,
  weekStartFromLabel,
  weekStartsOfMonth,
} from './lib.ts';

const WEEK = `<?xml version="1.0" encoding="utf-8" ?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es"><head><title>12-18 de octubre</title></head>
<body>
<header>
  <h1 class="du-fontSize--basePlus2"><span class="pageNum" data-no="12"></span>12-18 DE OCTUBRE</h1>
  <h2><strong><a href="#c1">LIBRO 42-44</a></strong></h2>
</header>
<div class="bodyTxt">
  <h3 class="dc-icon--music"><a href="x.xhtml#p1"><strong>Canción 103</strong></a> <strong>y oración | Palabras de introducción</strong> <span>(1 min.)</span></h3>
  <div class="dc-icon--gem"><h2><strong>TESOROS DE LA BIBLIA</strong></h2></div>
  <div><h3><strong>1. Un título de prueba</strong></h3>
    <div><div><p>(10 mins.)</p></div><p>Texto inventado.</p><p><strong>PREGÚNTESE:</strong> ¿Algo?</p></div>
  </div>
  <h3><strong>2. Busquemos perlas escondidas</strong></h3>
  <div><div><p>(10 mins.)</p></div><ul><li><p>Pregunta inventada.</p></li></ul></div>
  <h3><strong>3. Lectura de la Biblia</strong></h3>
  <div><p>(4 mins.) <a href="#c2">Lib 42:1-12</a> (<em>th</em> lección 5).</p></div>
  <div class="dc-icon--wheat"><h2><strong>SEAMOS MEJORES MAESTROS</strong></h2></div>
  <h3><strong>4. Empiece conversaciones</strong></h3>
  <div><p>(3 mins.) PREDICACIÓN INFORMAL. (<em>lmd</em> lección 1).</p></div>
  <h3><strong>5. Haga revisitas</strong></h3>
  <div><p>(4 mins.) DE CASA EN CASA.</p></div>
  <h3><strong>6. ¿Qué diría?</strong></h3>
  <div><p>(6 mins.) Análisis con el auditorio. Texto inventado.</p></div>
  <h3><strong>7. Discurso</strong></h3>
  <div><p>(4 mins.) <em>ijwbq</em> artículo 1.</p></div>
  <div><h2><strong>NUESTRA VIDA CRISTIANA</strong></h2></div>
  <h3><a href="x.xhtml#p9"><strong>Canción 47</strong></a></h3>
  <h3><strong>8. Necesidades&#160;de la congregación</strong></h3>
  <div><p>(15 mins.)</p></div>
  <h3><strong>9. Estudio bíblico de la congregación</strong></h3>
  <div><p>(30 mins.) <em>lfb</em> historia 1.</p></div>
  <h3><strong>Palabras de conclusión</strong> <span>(3 mins.)</span> <strong>|</strong> <span><a href="#"><strong>Canción 129</strong></a></span> <strong>y oración</strong></h3>
</div>
</body></html>`;

Deno.test('parses a week into sections, minutes, kinds and songs', () => {
  const w = parseWeekXhtml(WEEK, { year: 2026, month: 9 });
  assertEquals(w?.weekStart, '2026-10-12');
  assertEquals(w?.label, '12-18 DE OCTUBRE');
  assertEquals(w?.bibleReading, 'LIBRO 42-44');
  assertEquals(w?.songs, [103, 47, 129]);
  assertEquals(
    w?.parts.map((p) => [p.section, p.number, p.kind, p.minutes, p.title]),
    [
      ['inicio', null, 'intro', 1, 'Palabras de introducción'],
      ['tesoros', 1, 'tesoros', 10, 'Un título de prueba'],
      ['tesoros', 2, 'perlas', 10, 'Busquemos perlas escondidas'],
      ['tesoros', 3, 'lectura', 4, 'Lectura de la Biblia'],
      ['maestros', 4, 'estudiante', 3, 'Empiece conversaciones'],
      ['maestros', 5, 'estudiante', 4, 'Haga revisitas'],
      ['maestros', 6, 'analisis', 6, '¿Qué diría?'],
      ['maestros', 7, 'discurso', 4, 'Discurso'],
      ['vida', 8, 'parte', 15, 'Necesidades de la congregación'],
      ['vida', 9, 'estudio', 30, 'Estudio bíblico de la congregación'],
      ['vida', null, 'conclusion', 3, 'Palabras de conclusión'],
    ],
  );
});

Deno.test('non-week files are null and are not unzipped', () => {
  const cover = '<html><body><h1>Guía de actividades (septiembre y octubre de 2026)</h1></body></html>';
  assertEquals(parseWeekXhtml(cover, { year: 2026, month: 9 }), null);
  assertEquals(isWeekFile('OEBPS/202026257.xhtml'), true);
  assertEquals(isWeekFile('OEBPS/202026257-extracted.xhtml'), false);
  assertEquals(isWeekFile('OEBPS/toc.xhtml'), false);
});

Deno.test('week labels across months and years', () => {
  const sepOct = { year: 2026, month: 9 };
  const novDec = { year: 2026, month: 11 };
  assertEquals(weekStartFromLabel('5-11 DE OCTUBRE', sepOct), '2026-10-05');
  assertEquals(weekStartFromLabel('26 DE OCTUBRE A 1 DE NOVIEMBRE', sepOct), '2026-10-26');
  assertEquals(weekStartFromLabel('28 DE DICIEMBRE A 3 DE ENERO', novDec), '2026-12-28');
  assertEquals(weekStartFromLabel('4-10 DE ENERO', novDec), '2027-01-04');
  // Not a Monday → rejected rather than mis-keyed.
  assertEquals(weekStartFromLabel('6-12 DE OCTUBRE', sepOct), null);
});

Deno.test('issues are bimonthly, keyed by the odd month', () => {
  assertEquals(issueForWeek('2026-10-12'), { year: 2026, month: 9 });
  assertEquals(issueForWeek('2026-11-02'), { year: 2026, month: 11 });
  assertEquals(issueForWeek('2027-01-04'), { year: 2027, month: 1 });
  assertEquals(shiftIssue({ year: 2026, month: 11 }, 1), { year: 2027, month: 1 });
  assertEquals(shiftIssue({ year: 2027, month: 1 }, -1), { year: 2026, month: 11 });
});

Deno.test('a month is every Monday week that overlaps it', () => {
  assertEquals(weekStartsOfMonth('2026-10'), [
    '2026-09-28',
    '2026-10-05',
    '2026-10-12',
    '2026-10-19',
    '2026-10-26',
  ]);
  assertEquals(weekStartsOfMonth('2027-02'), ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22']);
});
