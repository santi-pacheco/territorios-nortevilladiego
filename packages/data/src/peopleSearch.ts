/**
 * Client-side person matching for the schedule pickers, mirroring the server's
 * private.norm_name (lower, unaccented, single spaces), so a name the picker calls "exact" is the
 * same one Mis asignaciones would match by spelling.
 */

export interface Searchable {
  name: string;
  aliases: readonly string[];
}

export interface PersonHit<T extends Searchable> {
  person: T;
  /** The alias that matched when the name itself did not; null when the name matched. */
  alias: string | null;
}

/** Lower case, no accents, single spaces: "  José  PÉREZ " → "jose perez". */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return normName(s)
    .split(/[\s.,;:()'"-]+/)
    .filter(Boolean);
}

/** Every query word is a prefix of a different word of `candidate` ("jo pe" ↔ "José Pérez"). */
function prefixMatch(candidate: string, queryWords: readonly string[]): boolean {
  const pool = words(candidate);
  for (const q of queryWords) {
    const i = pool.findIndex((w) => w.startsWith(q));
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return true;
}

/**
 * People whose name (or, failing that, an alias) matches `query` by word prefixes,
 * accent/case-insensitively. Name matches first, then alias matches, each by name.
 * An empty query returns everyone (by name).
 */
export function searchPeople<T extends Searchable>(
  people: readonly T[],
  query: string,
): PersonHit<T>[] {
  const q = words(query);
  const byName = (a: PersonHit<T>, b: PersonHit<T>) => a.person.name.localeCompare(b.person.name, 'es');
  if (q.length === 0) return people.map((person) => ({ person, alias: null })).sort(byName);
  const named: PersonHit<T>[] = [];
  const aliased: PersonHit<T>[] = [];
  for (const person of people) {
    if (prefixMatch(person.name, q)) {
      named.push({ person, alias: null });
      continue;
    }
    const alias = person.aliases.find((a) => prefixMatch(a, q));
    if (alias !== undefined) aliased.push({ person, alias });
  }
  return [...named.sort(byName), ...aliased.sort(byName)];
}

/** People whose name or an alias equals `text` once normalised (0, 1 or, rarely, more). */
export function exactPeople<T extends Searchable>(people: readonly T[], text: string): T[] {
  const n = normName(text);
  if (!n) return [];
  return people.filter((p) => normName(p.name) === n || p.aliases.some((a) => normName(a) === n));
}

/** The single person `text` names exactly, or null when none or ambiguous. */
export function uniquePerson<T extends Searchable>(people: readonly T[], text: string): T | null {
  const found = exactPeople(people, text);
  return found.length === 1 ? found[0]! : null;
}
