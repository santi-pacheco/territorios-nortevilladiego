// ISO day-of-week (1=Lunes ... 7=Domingo) — do NOT confuse with src/lib/days.ts,
// which uses JS getDay() (0=Domingo ... 6=Sábado) for the unrelated Mapa/Salidas feature.
export const CARRITO_DAY_NAMES: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};
