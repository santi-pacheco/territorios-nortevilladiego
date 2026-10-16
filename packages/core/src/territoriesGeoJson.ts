import type { Feature, FeatureCollection } from 'geojson';
import type { Territory, TerritoryGeometry } from './types';
import { colorForId } from './colors';

export interface TerritoryProps {
  id: number;
  fillColor: string;
  strokeColor: string;
  deepColor: string;
}

export function territoriesToFeatureCollection(
  territories: Territory[]
): FeatureCollection<TerritoryGeometry, TerritoryProps> {
  const features: Feature<TerritoryGeometry, TerritoryProps>[] = territories.map((t) => {
    const c = colorForId(t.id);
    return {
      type: 'Feature',
      id: t.id,
      geometry: t.feature.geometry,
      properties: { id: t.id, fillColor: c.fill, strokeColor: c.stroke, deepColor: c.deep },
    };
  });
  return { type: 'FeatureCollection', features };
}
