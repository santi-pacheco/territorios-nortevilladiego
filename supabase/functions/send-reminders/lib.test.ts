// deno test supabase/functions/send-reminders
import { assertEquals } from 'jsr:@std/assert@1.0.13';
import {
  addDays,
  type Candidate,
  composeMessage,
  formatDay,
  isGoneStatus,
  isIsoDate,
  selectDue,
  todayIn,
} from './lib.ts';

const U1 = '00000000-0000-4000-8000-0000000000a1';
const U2 = '00000000-0000-4000-8000-0000000000a2';

const carrito = (over: Partial<Candidate> = {}): Candidate => ({
  user_id: U1,
  key: 'carrito:x:2026-10-20',
  kind: 'carrito',
  date: '2026-10-20',
  start_time: '09:00',
  title: 'Plaza',
  place: 'Plaza',
  role: null,
  detail: 'Bruno Prueba',
  ...over,
});

Deno.test('addDays crosses month and year boundaries', () => {
  assertEquals(addDays('2026-10-31', 1), '2026-11-01');
  assertEquals(addDays('2026-12-25', 7), '2027-01-01');
});

Deno.test('todayIn uses the Buenos Aires calendar date', () => {
  // 02:30 UTC on the 17th is still the 16th in Buenos Aires (UTC-3).
  assertEquals(
    todayIn('America/Argentina/Buenos_Aires', new Date('2026-10-17T02:30:00Z')),
    '2026-10-16',
  );
  assertEquals(
    todayIn('America/Argentina/Buenos_Aires', new Date('2026-10-17T03:30:00Z')),
    '2026-10-17',
  );
});

Deno.test('isIsoDate', () => {
  assertEquals(isIsoDate('2026-10-17'), true);
  assertEquals(isIsoDate('2026-13-40'), false);
  assertEquals(isIsoDate('17/10/2026'), false);
  assertEquals(isIsoDate(undefined), false);
});

Deno.test('formatDay is the Spanish weekday + day of month', () => {
  assertEquals(formatDay('2026-10-20'), 'martes 20');
  assertEquals(formatDay('2026-10-18'), 'domingo 18');
  assertEquals(formatDay('2026-10-17'), 'sábado 17');
});

Deno.test('composeMessage: carrito in 7 days', () => {
  assertEquals(composeMessage(carrito(), 7), {
    title: 'Carrito en 7 días',
    body: 'martes 20 · 09:00 · Plaza',
    url: '/mis-asignaciones',
    tag: 'carrito:x:2026-10-20:7',
  });
});

Deno.test('composeMessage: programa tomorrow with role, no time or place', () => {
  const m = composeMessage(
    carrito({
      kind: 'programa',
      key: 'programa:midweek:2026-10-20:3',
      title: 'Lectura de la Biblia',
      role: 'Lector',
      start_time: '19:30',
      place: null,
      detail: null,
    }),
    1,
  );
  assertEquals(m.title, 'Mañana: Lectura de la Biblia (Lector)');
  assertEquals(m.body, 'martes 20 · 19:30');
});

Deno.test('composeMessage: programa without role, salida', () => {
  assertEquals(
    composeMessage(
      carrito({ kind: 'programa', title: 'Discurso', role: null, start_time: null, place: null }),
      1,
    ).title,
    'Mañana: Discurso',
  );
  const s = composeMessage(
    carrito({
      kind: 'salida',
      key: 'salida:m',
      title: 'Salón',
      place: 'Salón',
      role: 'Conductor',
      start_time: '09:45',
    }),
    7,
  );
  assertEquals(s.title, 'Salida (Conductor) en 7 días');
  assertEquals(s.body, 'martes 20 · 09:45 · Salón');
});

Deno.test('composeMessage never leaks other people (detail)', () => {
  const m = composeMessage(carrito({ detail: 'Bruno Prueba · Llevar exhibidor' }), 7);
  assertEquals(JSON.stringify(m).includes('Bruno'), false);
});

Deno.test('selectDue picks only today+7 and today+1', () => {
  const today = '2026-10-13';
  const due = selectDue(
    today,
    [
      carrito({ key: 'a', date: '2026-10-20' }), // +7
      carrito({ key: 'b', date: '2026-10-14' }), // +1
      carrito({ key: 'c', date: '2026-10-15' }), // +2
      carrito({ key: 'd', date: '2026-10-13' }), // today
      carrito({ key: 'e', date: '2026-10-21' }), // +8
    ],
    [],
  );
  assertEquals(
    due.map((d) => [d.assignment_key, d.offset_days]),
    [
      ['a', 7],
      ['b', 1],
    ],
  );
});

Deno.test('selectDue skips what reminder_log already has, per user and offset', () => {
  const today = '2026-10-13';
  const due = selectDue(
    today,
    [
      carrito({ key: 'a', date: '2026-10-20' }),
      carrito({ key: 'a', date: '2026-10-20', user_id: U2 }),
      carrito({ key: 'b', date: '2026-10-14' }),
    ],
    [
      { user_id: U1, assignment_key: 'a', offset_days: 7 },
      { user_id: U1, assignment_key: 'b', offset_days: 7 }, // other offset: does not block +1
    ],
  );
  assertEquals(
    due.map((d) => [d.user_id, d.assignment_key, d.offset_days]),
    [
      [U2, 'a', 7],
      [U1, 'b', 1],
    ],
  );
});

Deno.test('selectDue collapses duplicate candidate rows', () => {
  const c = carrito({ key: 'a', date: '2026-10-14' });
  assertEquals(selectDue('2026-10-13', [c, { ...c }], []).length, 1);
});

Deno.test('isGoneStatus: 404 and 410 only', () => {
  assertEquals([404, 410, 400, 429, 500, undefined].map(isGoneStatus), [
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
});
