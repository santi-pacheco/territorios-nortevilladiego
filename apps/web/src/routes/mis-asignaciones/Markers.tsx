import type { CSSProperties } from 'react';
import type { MyAssignment } from '../../lib/accounts';
import { dayToken } from './model';

export interface MarkerColors {
  /** Carrito place name → its colour. */
  place: Map<string, string>;
  /** Programa assignment key → its section colour. */
  section: Map<string, string>;
}

/**
 * Says what kind of assignment a row is by form as well as colour: a carrito turn gets its
 * place's square swatch, a programme part the small square of its section, a salida a short
 * stripe of its day's line.
 */
export function KindMarker({ a, colors }: { a: MyAssignment; colors: MarkerColors }) {
  if (a.kind === 'salida') {
    return (
      <span
        aria-hidden
        className="asig-marker asig-marker-salida"
        style={{ '--day': `var(--tk-day-${dayToken(a.date)}-accent)` } as CSSProperties}
      />
    );
  }
  const color =
    a.kind === 'carrito'
      ? colors.place.get(a.place ?? a.title)
      : colors.section.get(a.key);
  return (
    <span
      aria-hidden
      className={`asig-marker asig-marker-${a.kind}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}
