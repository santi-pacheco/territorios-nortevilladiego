import { kml as kmlToGeoJSON } from '@tmcw/togeojson';
import type { Feature, FeatureCollection } from 'geojson';
import type { Territory, TerritoryGeometry } from './types';

function parseTerritoryNumber(name: string | undefined): number | null {
  if (!name) return null;
  const m = name.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function centroidOfRing(ring: number[][]): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x = NaN, y = NaN] of ring) {
    sx += x;
    sy += y;
  }
  return [sy / ring.length, sx / ring.length];
}

function geometryCentroid(geom: TerritoryGeometry): [number, number] {
  if (geom.type === 'Polygon') {
    return centroidOfRing(geom.coordinates[0] ?? []);
  }
  return centroidOfRing(geom.coordinates[0]?.[0] ?? []);
}

export async function loadTerritories(url: string): Promise<Territory[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KML fetch failed: ${res.status}`);
  const text = await res.text();
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  const gj = kmlToGeoJSON(xml) as FeatureCollection;

  const territories: Territory[] = [];
  for (const f of gj.features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue;
    const id = parseTerritoryNumber(f.properties?.name as string | undefined);
    if (id == null) continue;
    const tg = geom as TerritoryGeometry;
    const feature: Feature<TerritoryGeometry, { id: number; name: string }> = {
      type: 'Feature',
      geometry: tg,
      properties: { id, name: `Territorio ${id}` }
    };
    territories.push({ id, feature, centroid: geometryCentroid(tg) });
  }
  territories.sort((a, b) => a.id - b.id);
  return territories;
}
