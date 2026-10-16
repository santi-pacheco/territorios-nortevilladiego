export interface TerritoryColor {
  base: string;     // base fill (light)
  fill: string;     // highlight fill
  stroke: string;   // outline
  deep: string;     // selected fill (darker)
  ink: string;      // text on color
}

// 8 hues repartidos por la rueda de color, bien distinguibles entre sí.
// Each entry is { base, fill, stroke, deep, ink }.
const PALETTE: [TerritoryColor, ...TerritoryColor[]] = [
  { base: '#f7c9c8', fill: '#e2504e', stroke: '#8f2422', deep: '#c23a38', ink: '#fff' },    // red
  { base: '#f9ddbf', fill: '#e8853c', stroke: '#8a4f18', deep: '#c86a24', ink: '#1f1300' }, // orange
  { base: '#f7ecb4', fill: '#e6c034', stroke: '#7c6410', deep: '#c39f1f', ink: '#1f1300' }, // yellow
  { base: '#c3e6bf', fill: '#4fa84a', stroke: '#1f5a20', deep: '#2f8a34', ink: '#fff' },    // green
  { base: '#b9e2dd', fill: '#3ba39a', stroke: '#10534d', deep: '#24847c', ink: '#fff' },    // teal
  { base: '#c0d3f0', fill: '#4a7fd0', stroke: '#1a3d78', deep: '#2f5fb0', ink: '#fff' },    // blue
  { base: '#d8c8e8', fill: '#8b5cc4', stroke: '#43276a', deep: '#6e3fa8', ink: '#fff' },    // purple
  { base: '#f0c8dd', fill: '#d05b9c', stroke: '#6f2452', deep: '#b03f80', ink: '#fff' }     // magenta
];

export function colorForId(id: number): TerritoryColor {
  const h = Math.abs(id * 2654435761) % PALETTE.length;
  return PALETTE[h] ?? PALETTE[0];
}

export function colorForFirst(ids: number[]): TerritoryColor {
  return colorForId(ids[0] ?? 0);
}
