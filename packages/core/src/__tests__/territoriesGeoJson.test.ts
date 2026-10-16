import { describe, it, expect } from 'vitest';
import { territoriesToFeatureCollection } from '../territoriesGeoJson';
import { colorForId } from '../colors';
import type { Territory } from '../types';

function terr(id: number): Territory {
  return {
    id,
    feature: {
      type: 'Feature',
      properties: { id, name: `T${id}` },
      geometry: { type: 'Polygon', coordinates: [[[-60.6, -33.0], [-60.5, -33.0], [-60.5, -32.9], [-60.6, -33.0]]] },
    },
    centroid: [-33.0, -60.55], // [lat, lng]
  };
}

describe('territoriesToFeatureCollection', () => {
  it('sets top-level numeric id and precomputed colors from colorForId', () => {
    const fc = territoriesToFeatureCollection([terr(7)]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0]!;
    expect(f.id).toBe(7);
    const c = colorForId(7);
    expect(f.properties).toEqual({ id: 7, fillColor: c.fill, strokeColor: c.stroke, deepColor: c.deep });
  });

  it('preserves geometry coordinates unchanged (lng,lat)', () => {
    const fc = territoriesToFeatureCollection([terr(3)]);
    expect(fc.features[0]!.geometry).toEqual(terr(3).feature.geometry);
  });

  it('handles MultiPolygon', () => {
    const t = terr(9);
    t.feature.geometry = { type: 'MultiPolygon', coordinates: [[[[-60.6, -33.0], [-60.5, -33.0], [-60.5, -32.9], [-60.6, -33.0]]]] };
    const fc = territoriesToFeatureCollection([t]);
    expect(fc.features[0]!.geometry.type).toBe('MultiPolygon');
    expect(fc.features[0]!.id).toBe(9);
  });
});
