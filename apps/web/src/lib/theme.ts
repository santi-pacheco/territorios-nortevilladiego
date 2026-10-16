export type ThemeChoice = 'system' | 'light' | 'dark' | 'sol';
const KEY = 'tm-theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'sol') return v;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const surface = getComputedStyle(root).getPropertyValue('--tk-bg-surface').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface || '#ffffff');
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // ignore
  }
  applyTheme(choice);
}
