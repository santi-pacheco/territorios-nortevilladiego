/**
 * Person names. The canonical spelling in the directory is "Name Surname(s)" ("Ana María Pérez
 * García"). Imported lists spell the same person in other ways ("Pérez García, Ana María",
 * "PÉREZ Ana", "A. Pérez", extra spaces, no accents); `matchPerson` maps them back to the one
 * person in the directory, and never invents a new one. Pure: no I/O.
 */

/** A directory person as far as matching goes (`name` is the canonical spelling). */
export interface MatchablePerson {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export type PersonMatch<T extends MatchablePerson = MatchablePerson> =
  | { status: 'matched'; person: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'none' };

/** Lower case, no accents, single spaces: "  José  PÉREZ " → "jose perez". */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'van', 'von', 'di']);

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isAllCaps(t: string): boolean {
  return t === t.toUpperCase() && t !== t.toLowerCase();
}

/** "PÉREZ" / "pérez" → "Pérez", keeping hyphen parts ("Díaz-Ruiz") and apostrophes. */
function capitalize(t: string): string {
  return t.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

function titleCase(tokens: string[], first: boolean): string[] {
  return tokens.map((t, i) => {
    const lower = t.toLowerCase();
    return PARTICLES.has(lower) && !(first && i === 0) ? lower : capitalize(t);
  });
}

/** Title-case only when the name is uniformly upper or lower case. */
function fixCase(tokens: string[]): string {
  const text = tokens.join(' ');
  const uniform = text === text.toUpperCase() || text === text.toLowerCase();
  return (uniform ? titleCase(tokens, true) : tokens).join(' ');
}

/**
 * The canonical "Name Surname(s)" spelling of a typed or imported name:
 *  - "Pérez García, Ana María" → "Ana María Pérez García"
 *  - "PÉREZ GARCÍA Ana María" (leading CAPS run, then the given names) → "Ana María Pérez García"
 *  - extra spaces collapse; an all-CAPS or all-lower name is title-cased ("de", "del"… stay lower).
 * Mixed-case names without a comma or a CAPS surname are kept as they are written.
 * This fixes the spelling, not the identity: use `matchPerson` to find the person.
 */
export function normalizePersonName(raw: string): string {
  const text = squash(raw);
  if (!text) return '';

  const comma = text.indexOf(',');
  if (comma !== -1) {
    const surnames = squash(text.slice(0, comma));
    const given = squash(text.slice(comma + 1).replace(/,/g, ' '));
    const joined = given && surnames ? `${given} ${surnames}` : given || surnames;
    return joined ? fixCase(joined.split(' ')) : '';
  }

  const tokens = text.split(' ');
  const caps = tokens.map(isAllCaps);
  if (tokens.length > 1 && caps.every(Boolean)) return fixCase(tokens);
  if (caps[0]) {
    let n = 0;
    while (n < tokens.length && (caps[n] || PARTICLES.has(tokens[n]!.toLowerCase()))) n++;
    // The CAPS run must be followed by given names, else there is nothing to rotate.
    if (n < tokens.length && caps[n - 1]) {
      const surnames = titleCase(tokens.slice(0, n), false);
      return [...tokens.slice(n), ...surnames].join(' ');
    }
  }
  return fixCase(tokens);
}

/** Words of a name, folded, without dots/commas: "A. Pérez" → ["a", "perez"]. */
function words(s: string): string[] {
  return foldName(s)
    .replace(/[.,;:()"]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Order-insensitive key: the same words in any order give the same key. */
function setKey(s: string): string {
  return words(s).sort().join(' ');
}

/**
 * Greedy assignment of `raw` words to distinct `cand` words: whole words first, then initials
 * ("a" matches any word starting with a). Returns how many raw words are whole-word matches,
 * or -1 when some raw word finds no candidate word.
 */
function coverage(raw: readonly string[], cand: readonly string[]): number {
  const pool = [...cand];
  const initials: string[] = [];
  let whole = 0;
  for (const w of raw) {
    if (w.length === 1) {
      initials.push(w);
      continue;
    }
    const i = pool.indexOf(w);
    if (i === -1) return -1;
    pool.splice(i, 1);
    whole++;
  }
  for (const w of initials) {
    const i = pool.findIndex((c) => c.startsWith(w));
    if (i === -1) return -1;
    pool.splice(i, 1);
  }
  return whole;
}

function labels(p: MatchablePerson): string[] {
  return [p.name, ...(p.aliases ?? [])];
}

function verdict<T extends MatchablePerson>(found: T[]): PersonMatch<T> {
  if (found.length === 1) return { status: 'matched', person: found[0]! };
  if (found.length > 1) return { status: 'ambiguous', candidates: found };
  return { status: 'none' };
}

/**
 * The directory person a raw name refers to, by decreasing confidence:
 *  1. same name or alias, ignoring case, accents and spacing;
 *  2. same words in another order ("Pérez, Ana", "PÉREZ Ana");
 *  3. initials or a shorter form of a longer name ("A. Pérez", "Ana Pérez" for "Ana Pérez García"),
 *     only with two or more words, at least one of them whole.
 * One hit at the first level that has any → matched; several → ambiguous (the editor picks);
 * none → none. A single word never matches loosely. Never creates anything.
 */
export function matchPerson<T extends MatchablePerson>(raw: string, people: readonly T[]): PersonMatch<T> {
  const canonical = normalizePersonName(raw);
  const rawWords = words(canonical);
  if (rawWords.length === 0) return { status: 'none' };

  const exact = foldName(canonical);
  const byName = people.filter((p) => labels(p).some((l) => foldName(l) === exact));
  if (byName.length > 0) return verdict(byName);

  const key = [...rawWords].sort().join(' ');
  const byWords = people.filter((p) => labels(p).some((l) => setKey(l) === key));
  if (byWords.length > 0) return verdict(byWords);

  if (rawWords.length < 2) return { status: 'none' };
  const same: T[] = [];
  const longer: T[] = [];
  for (const p of people) {
    let best: 'same' | 'longer' | null = null;
    for (const l of labels(p)) {
      const cand = words(l);
      if (coverage(rawWords, cand) < 1) continue;
      if (cand.length === rawWords.length) best = 'same';
      else if (cand.length > rawWords.length && best === null) best = 'longer';
    }
    if (best === 'same') same.push(p);
    else if (best === 'longer') longer.push(p);
  }
  return verdict(same.length > 0 ? same : longer);
}
