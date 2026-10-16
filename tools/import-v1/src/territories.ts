import { readFile } from 'node:fs/promises';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { loadTerritories } from '@territorios/core';
import type { Report, TerritoryRow } from './types';

/**
 * Reads the KML with core's loadTerritories(). Node has no DOMParser and its fetch()
 * rejects file: URLs, so we install xmldom's parser and hand core a data: URL.
 */
export async function territoriesFromKml(path: string, report: Report): Promise<TerritoryRow[]> {
  const g = globalThis as { DOMParser?: unknown };
  g.DOMParser ??= XmlDomParser;

  const text = await readFile(path);
  const url = `data:application/vnd.google-earth.kml+xml;base64,${text.toString('base64')}`;
  const territories = await loadTerritories(url);

  const rows: TerritoryRow[] = [];
  const seen = new Set<number>();
  for (const t of territories) {
    if (seen.has(t.id)) {
      report.warn('territory: duplicate id in KML (kept first)', `id ${t.id}`);
      continue;
    }
    seen.add(t.id);
    const [lat, lng] = t.centroid;
    assertCentroidOrder(t.id, t.feature.geometry, lat, lng);
    rows.push({
      id: t.id,
      name: t.feature.properties.name,
      geometry: { type: t.feature.geometry.type, coordinates: t.feature.geometry.coordinates },
      // Postgres float8 text output may drop the last digit; 1e-9° (~0.1 mm) round-trips exactly.
      centroid_lng: round9(lng),
      centroid_lat: round9(lat),
    });
  }
  return rows;
}

const round9 = (n: number) => Math.round(n * 1e9) / 1e9;

// core returns centroid as [lat, lng]; GeoJSON coords are [lng, lat]. A swap would still pass
// the DB range checks at this latitude, so verify the centroid sits inside the ring's bbox.
function assertCentroidOrder(id: number, geom: { type: string; coordinates: unknown }, lat: number, lng: number) {
  const ring = (geom.type === 'Polygon'
    ? (geom.coordinates as number[][][])[0]
    : (geom.coordinates as number[][][][])[0]?.[0]) ?? [];
  const xs = ring.map((p) => p[0]!);
  const ys = ring.map((p) => p[1]!);
  const inside =
    lng >= Math.min(...xs) && lng <= Math.max(...xs) && lat >= Math.min(...ys) && lat <= Math.max(...ys);
  if (!inside) throw new Error(`territory ${id}: centroid outside its ring bbox (lat/lng swapped?)`);
}
