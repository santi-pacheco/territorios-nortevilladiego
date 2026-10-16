export interface DayDef {
  key: string;
  label: string;
  short: string;
  dow: number; // JS getDay()
  regex: RegExp;
}

export const DAY_DEFS: DayDef[] = [
  { key: 'lun', label: 'Lunes',     short: 'Lun', dow: 1, regex: /\bLunes\b/i },
  { key: 'mar', label: 'Martes',    short: 'Mar', dow: 2, regex: /\bMartes\b/i },
  { key: 'mie', label: 'Miércoles', short: 'Mié', dow: 3, regex: /\bMi[eé]rcoles\b/i },
  { key: 'jue', label: 'Jueves',    short: 'Jue', dow: 4, regex: /\bJueves\b/i },
  { key: 'vie', label: 'Viernes',   short: 'Vie', dow: 5, regex: /\bViernes\b/i },
  { key: 'sab', label: 'Sábado',    short: 'Sáb', dow: 6, regex: /\bS[aá]bado\b/i },
  { key: 'dom', label: 'Domingo',   short: 'Dom', dow: 0, regex: /\bDomingo\b/i }
];

export function detectDay(text: string): DayDef | null {
  for (const d of DAY_DEFS) if (d.regex.test(text)) return d;
  return null;
}

export function todayDow(): number {
  return new Date().getDay();
}

export function dayDefByDow(dow: number): DayDef | undefined {
  return DAY_DEFS.find((d) => d.dow === dow);
}
