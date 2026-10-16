// Colores por día para la tarjeta de Salidas (base ModeloNuevo.jpeg).
// header = banda de título; band = filas de campos; soft = relleno claro.

export interface DayColor {
  label: string;  // "MIERCOLES"
  header: string; // fondo de la banda de título
  band: string;   // fondo de las filas de campos
  soft: string;   // relleno más claro
  ink: string;    // texto sobre las bandas
}

// dow: 0=Dom, 1=Lun … 6=Sáb.
export const DAY_COLORS_BY_DOW: Record<number, DayColor> = {
  1: { label: 'LUNES',     header: '#e0b4b4', band: '#eecccc', soft: '#f6e6e6', ink: '#4a1616' },
  2: { label: 'MARTES',    header: '#d9c2e0', band: '#e7d6ee', soft: '#f1e8f6', ink: '#3a1650' },
  3: { label: 'MIERCOLES', header: '#b3b3b3', band: '#d9d9d9', soft: '#f2f2f2', ink: '#1a1a1a' },
  4: { label: 'JUEVES',    header: '#a9c0e0', band: '#c9d8ee', soft: '#dbe5f1', ink: '#16294a' },
  5: { label: 'VIERNES',   header: '#f1dca7', band: '#faecc6', soft: '#fdf6e6', ink: '#5a4413' },
  6: { label: 'SABADO',    header: '#c6e0b4', band: '#d8ebcb', soft: '#e6f0dd', ink: '#33491f' },
  0: { label: 'DOMINGO',   header: '#a9c0e0', band: '#c9d8ee', soft: '#dbe5f1', ink: '#16294a' },
};

const FALLBACK: DayColor = { label: 'DÍA', header: '#cccccc', band: '#e0e0e0', soft: '#f2f2f2', ink: '#1a1a1a' };

export function colorForDow(dow: number): DayColor {
  return DAY_COLORS_BY_DOW[dow] ?? FALLBACK;
}
