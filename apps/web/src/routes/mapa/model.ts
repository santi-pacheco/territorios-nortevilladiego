/** Pure helpers for the Mapa screen. No maplibre and no DOM here, so they stay unit-testable. */
import type { GroupTerritories, ServiceMeetingRow, TerritoryGeometry } from '@territorios/data';
import { minutesOf } from '../../lib/week';

const GROUP_KEYS = ['G1', 'G2', 'G3', 'G4'] as const;

/** Every territory a salida works: `territory_ids` plus, on Domingo, each group's list. */
export function territoriesOfMeeting(m: ServiceMeetingRow): number[] {
  const ids = new Set(m.territory_ids);
  for (const g of GROUP_KEYS) for (const id of m.group_territories[g] ?? []) ids.add(id);
  return [...ids];
}

export function territoriesOfDay(meetings: ServiceMeetingRow[]): Set<number> {
  const ids = new Set<number>();
  for (const m of meetings) for (const id of territoriesOfMeeting(m)) ids.add(id);
  return ids;
}

export interface MeetingUse {
  meeting: ServiceMeetingRow;
  /** "Grupo 2" when a Domingo group works the territory. */
  groups: string[];
}

/** All salidas of the day that use `territoryId`, in time order. */
export function meetingsForTerritory(
  meetings: ServiceMeetingRow[],
  territoryId: number,
): MeetingUse[] {
  const uses: MeetingUse[] = [];
  for (const m of meetings) {
    const groups = groupsUsing(m.group_territories, territoryId);
    if (m.territory_ids.includes(territoryId) || groups.length) uses.push({ meeting: m, groups });
  }
  return uses.sort(
    (a, b) =>
      (minutesOf(a.meeting.start_time) ?? 0) - (minutesOf(b.meeting.start_time) ?? 0) ||
      a.meeting.position - b.meeting.position,
  );
}

function groupsUsing(groups: GroupTerritories, id: number): string[] {
  return GROUP_KEYS.filter((g) => groups[g]?.includes(id)).map((g) => `Grupo ${g.slice(1)}`);
}

/** `?t=12,14` → [12, 14]. Ignores junk; never throws. */
export function parseTerritoryParam(value: string | null): number[] {
  if (!value) return [];
  const ids = value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

export type Bounds = [[number, number], [number, number]];

/** Bounding box [[west, south], [east, north]] of the given geometries; null when empty. */
export function boundsOf(geometries: TerritoryGeometry[]): Bounds | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (pos: number[]) => {
    const [x, y] = pos as [number, number];
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  };
  for (const g of geometries) {
    const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polygons) for (const ring of poly) ring.forEach(visit);
  }
  return Number.isFinite(w)
    ? [
        [w, s],
        [e, n],
      ]
    : null;
}

export interface DeviceHint {
  kind: 'web' | 'ios' | 'android';
  userAgent: string;
  maxTouchPoints: number;
}

/** "Cómo llegar": the OS map app on phones, Google Maps everywhere else. */
export function directionsUrl(lat: number, lng: number, label: string, device: DeviceHint): string {
  const at = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const ua = device.userAgent;
  const android = device.kind === 'android' || (device.kind === 'web' && /Android/i.test(ua));
  const ios =
    device.kind === 'ios' ||
    (device.kind === 'web' &&
      (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && device.maxTouchPoints > 1)));
  if (android) return `geo:${at}?q=${at}(${encodeURIComponent(label)})`;
  if (ios) return `https://maps.apple.com/?daddr=${at}&q=${encodeURIComponent(label)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}

/** Ring of `steps` points approximating a circle of `radiusM` metres (accuracy halo). */
export function circleRing(lng: number, lat: number, radiusM: number, steps = 64): number[][] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

export type LocateMode = 'off' | 'follow' | 'compass';

/** Locate button cycle: off → follow → compass → off (compass skipped without a sensor). */
export function nextLocateMode(mode: LocateMode, headingSupported: boolean): LocateMode {
  if (mode === 'off') return 'follow';
  if (mode === 'follow') return headingSupported ? 'compass' : 'off';
  return 'follow'; // v1 rule: leaving the compass keeps following; a drag turns locate off.
}
