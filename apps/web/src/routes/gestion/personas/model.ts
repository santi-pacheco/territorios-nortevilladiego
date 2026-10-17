import type { DutyRole, NameSource, NameSourceKind, PersonRow } from '@territorios/data';

/** Lower case, no accents, single spaces: the client mirror of private.norm_name. */
export function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const DUTY_LABEL: Record<DutyRole, string> = {
  computadora: 'Computadora',
  sonido: 'Sonido',
  microfonista: 'Micrófono',
  acomodador: 'Acomodador',
};

export const DUTY_ORDER: readonly DutyRole[] = ['computadora', 'sonido', 'microfonista', 'acomodador'];

const SOURCE_LABEL: Record<NameSourceKind, string> = {
  programa: 'Programa',
  salida: 'Salidas',
  privilegio: 'Privilegios',
};

/** Unmatched names only, the most used first (that is where linking pays off), then A–Z. */
export function unmatchedNames(sources: readonly NameSource[]): NameSource[] {
  return sources
    .filter((s) => s.person_id === null)
    .sort((a, b) => b.uses - a.uses || norm(a.name).localeCompare(norm(b.name)));
}

/** Every word of the query must start a word of the name or of an alias. */
export function filterPeople<T extends Pick<PersonRow, 'name' | 'aliases'>>(
  people: readonly T[],
  query: string,
): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return [...people];
  return people.filter((p) =>
    [p.name, ...p.aliases].some((label) => {
      const parts = norm(label).split(' ');
      return words.every((w) => parts.some((part) => part.startsWith(w)));
    }),
  );
}

/**
 * Adds a spelling to a person's aliases. Returns null when there is nothing to add: empty,
 * the person's own name, or a spelling already in the list (accents and case ignored).
 */
export function mergeAlias(name: string, aliases: readonly string[], alias: string): string[] | null {
  const clean = alias.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const key = norm(clean);
  if (key === norm(name) || aliases.some((a) => norm(a) === key)) return null;
  return [...aliases, clean];
}

export function removeAlias(aliases: readonly string[], alias: string): string[] {
  return aliases.filter((a) => a !== alias);
}

/** Toggles a duty, keeping the canonical column order. */
export function toggleDuty(duties: readonly DutyRole[], duty: DutyRole): DutyRole[] {
  const has = duties.includes(duty);
  return DUTY_ORDER.filter((d) => (d === duty ? !has : duties.includes(d)));
}

/** Fixed table: ICU versions disagree on "sep" vs "sept". */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dateLabel(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

/** "Programa · Salidas", "3 veces", "del 2 sep al 28 oct" (or "el 2 sep"). */
export function describeSource(source: NameSource): { where: string; uses: string; when: string | null } {
  const where = source.sources.map((s) => SOURCE_LABEL[s]).join(' · ');
  const uses = source.uses === 1 ? '1 vez' : `${source.uses} veces`;
  const { first_date: first, last_date: last } = source;
  let when: string | null = null;
  if (first && last && first !== last) when = `del ${dateLabel(first)} al ${dateLabel(last)}`;
  else if (first ?? last) when = `el ${dateLabel((first ?? last) as string)}`;
  return { where, uses, when };
}
