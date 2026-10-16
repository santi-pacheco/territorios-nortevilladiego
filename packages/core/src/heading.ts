// Normaliza un ángulo en grados al rango [0, 360).
export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
