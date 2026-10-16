/**
 * Change marks: a salida whose version moved since the member last looked keeps a
 * "Cambió" mark until they have seen it. First sight of a salida is not a change.
 */
const KEY = 'tm-seen-versions';
type Seen = Record<string, number>;

function read(): Seen {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Seen;
  } catch {
    return {};
  }
}

export function changedSinceSeen(id: string, version: number): boolean {
  const seen = read()[id];
  return seen !== undefined && version > seen;
}

export function markSeen(items: { id: string; version: number }[]): void {
  if (!items.length) return;
  const seen = read();
  for (const { id, version } of items) seen[id] = version;
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // ignore
  }
}
