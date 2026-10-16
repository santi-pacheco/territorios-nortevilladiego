import type { MapTheme } from './engine';

// The shell sets data-theme on <html> (or leaves it to the OS).
const darkQuery = () => matchMedia('(prefers-color-scheme: dark)');

export function subscribeTheme(cb: () => void): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = darkQuery();
  mq.addEventListener('change', cb);
  return () => {
    observer.disconnect();
    mq.removeEventListener('change', cb);
  };
}

export function themeSnapshot(): MapTheme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark' || attr === 'sol') return attr;
  return darkQuery().matches ? 'dark' : 'light';
}
