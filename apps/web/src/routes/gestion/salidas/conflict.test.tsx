import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ServiceMeetingRow } from '@territorios/data';
import { conflictRows, formatField, reapplyVars } from './conflict';
import { ConflictSheet } from './ConflictSheet';

function meeting(over: Partial<ServiceMeetingRow>): ServiceMeetingRow {
  return {
    id: '00000000-0000-4000-8000-000000000101',
    week_id: '00000000-0000-4000-8000-000000000100',
    dow: 4,
    position: 0,
    kind: 'normal',
    start_time: '09:00',
    groups: '1 y 2',
    conductor: 'Conductor Ejemplo',
    place: 'Lugar Ejemplo',
    territory_ids: [1, 2],
    group_territories: {},
    version: 3,
    updated_at: '2026-10-12T00:00:00Z',
    updated_by: null,
    ...over,
  } as ServiceMeetingRow;
}

describe('conflict sheet logic', () => {
  it('lists one row per patched field with your value next to theirs', () => {
    const rows = conflictRows({ place: 'Lugar Mío' }, meeting({ place: 'Lugar De Ellos' }));
    expect(rows).toEqual([
      { key: 'place', label: 'Lugar', yours: 'Lugar Mío', theirs: 'Lugar De Ellos' },
    ]);
  });

  it('only shows the fields that were actually patched', () => {
    const rows = conflictRows(
      { conductor: 'Ana', start_time: '10:00' },
      meeting({ conductor: 'Bruno', start_time: '09:00', place: 'Otro' }),
    );
    expect(rows.map((r) => r.key)).toEqual(['start_time', 'conductor']);
    expect(rows.find((r) => r.key === 'place')).toBeUndefined();
  });

  it('formats territory ids and Sunday group territories as lists, not JSON', () => {
    expect(formatField('territory_ids', [5, 12])).toBe('5, 12');
    expect(formatField('territory_ids', [])).toBe('Sin territorios');
    expect(formatField('group_territories', { G1: [1], G2: [], G3: [3, 4] })).toBe(
      'G1: 1 · G3: 3, 4',
    );
    expect(formatField('place', '   ')).toBe('—');
  });

  it('re-applies the patch on the new version returned by the conflict', () => {
    const current = meeting({ version: 7 });
    expect(reapplyVars(current, { place: 'Lugar Mío' })).toEqual({
      id: current.id,
      version: 7,
      patch: { place: 'Lugar Mío' },
    });
  });

  it('renders both choices with their values when the row still exists', () => {
    const html = renderToStaticMarkup(
      <ConflictSheet
        conflict={{ id: 'x', patch: { place: 'Lugar Mío' }, current: meeting({ place: 'Lugar De Ellos' }) }}
        onUseTheirs={() => {}}
        onKeepMine={() => {}}
      />,
    );
    expect(html).toContain('Alguien cambió esta salida');
    expect(html).toContain('Lugar Mío');
    expect(html).toContain('Lugar De Ellos');
    expect(html).toContain('Usar lo de ellos');
    expect(html).toContain('Guardar lo mío');
  });

  it('renders only an acknowledgement when the row was deleted', () => {
    const html = renderToStaticMarkup(
      <ConflictSheet
        conflict={{ id: 'x', patch: { place: 'Lugar Mío' }, current: null }}
        onUseTheirs={() => {}}
        onKeepMine={() => {}}
      />,
    );
    expect(html).toContain('borró');
    expect(html).toContain('Entendido');
    expect(html).not.toContain('Guardar lo mío');
  });
});
