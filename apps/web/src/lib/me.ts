import { useMyLink } from './accounts';

/** "Soy…": the member's own name, kept only on this device. Never sent to the server. */
const KEY = 'tm-me';

export function readMe(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveMe(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(KEY, name.trim());
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Accent- and case-insensitive name match, so "Jose" finds "José Pérez". */
export function matchesMe(me: string, text: string): boolean {
  if (!me.trim()) return false;
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  return norm(text).includes(norm(me.trim()));
}

/**
 * The name to highlight: the linked person's name when the account is linked (set by an
 * encargado), otherwise the local "Soy…" name.
 */
export function useMeName(): string {
  const link = useMyLink();
  return link.data?.person_name ?? readMe();
}
