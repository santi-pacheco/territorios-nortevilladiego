import { describe, expect, it } from 'vitest';
import type { DutyDayRow, DutyRosterRow } from '@territorios/data';
import { bannerText, buildRosterDays, meetingDays, namesFor, nextDate, parseMesParam } from './model';

const OCT = { year: 2026, month: 9 };
const meta = { updated_at: '2026-10-01T00:00:00Z', version: 1, updated_by: null };
const row = (date: string, role: DutyRosterRow['role'], slot: number, name: string): DutyRosterRow => ({
  id: `${date}-${role}-${slot}`,
  date,
  role,
  slot,
  person_id: null,
  person_name: name,
  note: null,
  ...meta,
});

describe('privilegios model', () => {
  it('lists the Tuesdays and Saturdays of the month', () => {
    expect(meetingDays(OCT)).toEqual([
      '2026-10-03',
      '2026-10-06',
      '2026-10-10',
      '2026-10-13',
      '2026-10-17',
      '2026-10-20',
      '2026-10-24',
      '2026-10-27',
      '2026-10-31',
    ]);
  });

  it('builds one day per meeting, keeps extra dates with rows and applies day marks', () => {
    const mark: DutyDayRow = { date: '2026-10-06', kind: 'asamblea', note: 'Asamblea regional', ...meta };
    const days = buildRosterDays(
      OCT,
      [row('2026-10-13', 'microfonista', 2, 'Beto Prueba'), row('2026-10-13', 'microfonista', 1, 'Ana Prueba'), row('2026-10-15', 'sonido', 1, 'Ciro Prueba')],
      [mark],
    );
    expect(days.map((d) => d.date)).toContain('2026-10-15');
    const assembly = days.find((d) => d.date === '2026-10-06')!;
    expect(assembly.kind).toBe('asamblea');
    expect(bannerText(assembly)).toBe('Asamblea regional');
    const tuesday = days.find((d) => d.date === '2026-10-13')!;
    expect(namesFor(tuesday, 'microfonista').map((r) => r.person_name)).toEqual(['Ana Prueba', 'Beto Prueba']);
    expect(nextDate(days, '2026-10-14')).toBe('2026-10-15');
  });

  it('falls back to a default banner and to the current month for bad ?mes', () => {
    expect(bannerText({ kind: 'sin_reunion', mark: null })).toBe('Sin reunión');
    expect(parseMesParam('2026-13', OCT)).toEqual(OCT);
    expect(parseMesParam('2027-01', OCT)).toEqual({ year: 2027, month: 0 });
  });
});
