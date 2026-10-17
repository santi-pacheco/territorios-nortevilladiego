import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ServiceMeetingRow } from '@territorios/data';
import {
  boundsOf,
  directionsUrl,
  meetingsForTerritory,
  nextLocateMode,
  parseTerritoryParam,
  territoriesOfDay,
} from './model';
import { TerritorySheet } from './TerritorySheet';

function meeting(over: Partial<ServiceMeetingRow>): ServiceMeetingRow {
  return {
    id: crypto.randomUUID(),
    week_id: '00000000-0000-4000-8000-000000000101',
    dow: 4,
    position: 0,
    kind: 'normal',
    start_time: '09:00',
    groups: '',
    conductor: 'Conductor Ejemplo',
    place: 'Lugar Ejemplo',
    territory_ids: [],
    group_territories: {},
    version: 1,
    updated_at: '2026-10-12T00:00:00Z',
    updated_by: null,
    ...over,
  } as ServiceMeetingRow;
}

describe('mapa model', () => {
  it('lists every salida of the day that uses a territory, in time order', () => {
    const day = [
      meeting({ start_time: '17:30', territory_ids: [2, 3], place: 'Tarde' }),
      meeting({ start_time: '09:00', territory_ids: [1, 2], place: 'Mañana' }),
      meeting({ start_time: '19:00', territory_ids: [4] }),
    ];
    expect(meetingsForTerritory(day, 2).map((u) => u.meeting.place)).toEqual(['Mañana', 'Tarde']);
    expect(territoriesOfDay(day)).toEqual(new Set([1, 2, 3, 4]));
  });

  it('reads Domingo territories from the group layout and names the group', () => {
    const domingo = meeting({
      dow: 0,
      kind: 'domingo',
      group_territories: { G1: [1], G2: [2], G3: [3, 2], G4: [] },
    });
    expect(territoriesOfDay([domingo])).toEqual(new Set([1, 2, 3]));
    expect(meetingsForTerritory([domingo], 2)[0]?.groups).toEqual(['Grupo 2', 'Grupo 3']);
  });

  it('parses ?t= defensively', () => {
    expect(parseTerritoryParam('12,14')).toEqual([12, 14]);
    expect(parseTerritoryParam('1, x,-3,1,2.5')).toEqual([1]);
    expect(parseTerritoryParam(null)).toEqual([]);
  });

  it('computes bounds across polygons and multipolygons', () => {
    expect(
      boundsOf([
        {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [-2, 3],
                [-1, 3],
                [-1, 4],
                [-2, 3],
              ],
            ],
          ],
        },
      ]),
    ).toEqual([
      [-2, 0],
      [1, 4],
    ]);
    expect(boundsOf([])).toBeNull();
  });

  it('opens the OS map app for directions', () => {
    const at = (kind: 'web' | 'ios' | 'android', userAgent: string, maxTouchPoints = 0) =>
      directionsUrl(-34.6, -58.4, 'Territorio 1', { kind, userAgent, maxTouchPoints });
    expect(at('android', '')).toMatch(/^geo:-34\.600000,-58\.400000\?q=/);
    expect(at('web', 'Mozilla/5.0 (Linux; Android 14)')).toMatch(/^geo:/);
    expect(at('web', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)')).toMatch(
      /^https:\/\/maps\.apple\.com\//,
    );
    expect(at('web', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toMatch(/maps\.apple\.com/);
    expect(at('web', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-34.600000,-58.400000',
    );
  });

  it('cycles locate off → follow → compass → follow (v1 rule)', () => {
    expect(nextLocateMode('off', true)).toBe('follow');
    expect(nextLocateMode('follow', true)).toBe('compass');
    expect(nextLocateMode('compass', true)).toBe('follow');
    expect(nextLocateMode('follow', false)).toBe('off');
  });
});

describe('territory sheet', () => {
  it('renders meeting text as text, never as HTML (XSS)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(
      <TerritorySheet
        territoryId={1}
        dayLabel="Jueves 15"
        uses={[
          {
            meeting: meeting({ place: payload, conductor: payload, territory_ids: [1] }),
            groups: [],
          },
        ]}
        directions="https://www.google.com/maps/dir/?api=1&destination=0,0"
        onClose={() => {}}
      />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('lists all salidas of the day for the territory', () => {
    const uses = meetingsForTerritory(
      [
        meeting({ start_time: '09:00', territory_ids: [1], place: 'Primera' }),
        meeting({ start_time: '17:30', territory_ids: [1], place: 'Segunda' }),
      ],
      1,
    );
    const html = renderToStaticMarkup(
      <TerritorySheet
        territoryId={1}
        dayLabel="Jueves 15"
        uses={uses}
        directions="geo:0,0"
        onClose={() => {}}
      />,
    );
    expect(html).toContain('2 salidas');
    expect(html).toContain('Primera');
    expect(html).toContain('Segunda');
    expect(html).not.toContain('target="_blank"');
  });
});
