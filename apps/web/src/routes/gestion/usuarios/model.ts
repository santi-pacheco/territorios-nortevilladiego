import type { AccountRow } from '../../../lib/accounts';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Every word of the query must start a word of the name: "ana pr" finds "Ana Prueba". */
export function filterPeople<T extends { name: string }>(people: T[], query: string): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return people;
  return people.filter((p) => {
    const parts = norm(p.name).split(' ');
    return words.every((w) => parts.some((part) => part.startsWith(w)));
  });
}

/** Accounts waiting for a link first (that is the work), then by name. */
export function sortAccounts(list: AccountRow[]): AccountRow[] {
  const label = (a: AccountRow) => norm(a.display_name ?? a.email ?? '');
  return [...list].sort(
    (a, b) => Number(Boolean(a.person_id)) - Number(Boolean(b.person_id)) || label(a).localeCompare(label(b)),
  );
}
