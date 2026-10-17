import type { ServiceMeetingRow } from '@territorios/data';
import { minutesOf } from './week';

/**
 * One colour per salida of the day, so the territories that go out together share a colour
 * on the map and on the Salidas roundels. Ordered so consecutive salidas never look alike.
 * Every hue carries white numerals at >= 4.5:1.
 */
export const SALIDA_COLORS = [
  '#C2410C', // orange
  '#1D4ED8', // blue
  '#15803D', // green
  '#7E22CE', // purple
  '#BE185D', // pink
  '#0E7490', // cyan
  '#A16207', // amber
  '#4338CA', // indigo
] as const;

export interface DayColors {
  /** Colour of a salida (or of one Domingo group): key = `${meetingId}` or `${meetingId}:G2`. */
  byKey: Map<string, string>;
  /** Colour of each territory worked that day (first salida in time order wins). */
  byTerritory: Map<number, string>;
}

const GROUPS = ['G1', 'G2', 'G3', 'G4'] as const;

export function dayColors(meetings: ServiceMeetingRow[]): DayColors {
  const ordered = [...meetings].sort(
    (a, b) =>
      (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0) || a.position - b.position,
  );
  const byKey = new Map<string, string>();
  const byTerritory = new Map<number, string>();
  let next = 0;
  const take = () => SALIDA_COLORS[next++ % SALIDA_COLORS.length]!;
  const claim = (ids: number[], color: string) => {
    for (const id of ids) if (!byTerritory.has(id)) byTerritory.set(id, color);
  };
  for (const m of ordered) {
    if (m.territory_ids.length) {
      const color = take();
      byKey.set(m.id, color);
      claim(m.territory_ids, color);
    }
    // Domingo: each group works its own territories, so each group gets its own colour.
    for (const g of GROUPS) {
      const ids = m.group_territories[g];
      if (!ids?.length) continue;
      const color = take();
      byKey.set(`${m.id}:${g}`, color);
      claim(ids, color);
    }
  }
  return { byKey, byTerritory };
}
