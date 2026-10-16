import type { SalidasSchedule, SalidaSlot, DomingoSlot, DayEntry, DayKind } from './types';

const STORAGE_KEY = 'salidas-v1';

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function emptySlot(): SalidaSlot {
  return { id: uid(), hora: '', grupos: '', conductor: '', lugar: '', territorio: '' };
}

export function emptyDomingo(): DomingoSlot {
  return { id: uid(), hora: '', grupos: '', conductor: '', lugar: '', territorioNumero: '' };
}

// Normaliza un domingoSlot: acepta el formato viejo (g1..g4) y lo junta en `grupos`.
export function normalizeDomingoSlot(raw: unknown): DomingoSlot {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const grupos = typeof r.grupos === 'string'
    ? r.grupos
    : [r.g1, r.g2, r.g3, r.g4].map(str).filter(Boolean).join(', ');
  return {
    id: typeof r.id === 'string' ? r.id : uid(),
    hora: str(r.hora),
    grupos,
    conductor: str(r.conductor),
    lugar: str(r.lugar),
    territorioNumero: str(r.territorioNumero),
  };
}

export function kindForDow(dow: number): DayKind {
  return dow === 0 ? 'domingo' : 'normal';
}

// Clave de orden Lun→Dom (Lunes=0 … Domingo=6).
export function dayOrder(dow: number): number {
  return (dow + 6) % 7;
}

// Nuevo día con un slot vacío del tipo correcto.
export function makeDay(dow: number): DayEntry {
  const kind = kindForDow(dow);
  return {
    id: uid(),
    dow,
    kind,
    slots: kind === 'normal' ? [emptySlot()] : [],
    domingoSlots: kind === 'domingo' ? [emptyDomingo()] : [],
  };
}

export function sortDays(days: DayEntry[]): DayEntry[] {
  return [...days].sort((a, b) => dayOrder(a.dow) - dayOrder(b.dow));
}

const MESES_ES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

// Fecha concreta de un dow, dentro de la semana (Lun→Dom) de weekStart.
export function dayDateForDow(weekStart: string | undefined, dow: number): Date | null {
  if (!weekStart) return null;
  const base = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const monOffset = (base.getDay() + 6) % 7; // Lunes de esa semana
  const monday = new Date(base);
  monday.setDate(base.getDate() - monOffset);
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayOrder(dow));
  return d;
}

// Número de día del mes para un dow, dentro de la semana (Lun→Dom) de weekStart.
export function dayNumberForDow(weekStart: string | undefined, dow: number): number | null {
  return dayDateForDow(weekStart, dow)?.getDate() ?? null;
}

// Mes a mostrar para un dow. Si el día cae en el mismo mes que weekStart se usa
// la etiqueta manual (`fallback`); si la semana cruza de mes, se deriva el
// nombre real del mes de ese día.
export function monthLabelForDow(weekStart: string | undefined, dow: number, fallback: string): string {
  const base = weekStart ? new Date(`${weekStart}T00:00:00`) : null;
  const d = dayDateForDow(weekStart, dow);
  if (!base || !d || Number.isNaN(base.getTime())) return fallback;
  if (d.getMonth() === base.getMonth() && d.getFullYear() === base.getFullYear()) return fallback;
  return MESES_ES[d.getMonth()] ?? fallback;
}

// Plantilla en blanco: Mié×3, Jue×3, Vie×3, Sáb×2, Dom×1 (igual que ModeloNuevo).
export function defaultSchedule(): SalidasSchedule {
  const mkNormal = (dow: number, n: number): DayEntry => ({
    id: uid(),
    dow,
    kind: 'normal',
    slots: Array.from({ length: n }, () => emptySlot()),
    domingoSlots: [],
  });
  return {
    mes: '',
    weekStart: '',
    days: [
      mkNormal(3, 3),
      mkNormal(4, 3),
      mkNormal(5, 3),
      mkNormal(6, 2),
      { id: uid(), dow: 0, kind: 'domingo', slots: [], domingoSlots: [emptyDomingo()] },
    ],
  };
}

// Normaliza los domingoSlots de un día (soporta el formato viejo g1..g4).
function normalizeDay(day: DayEntry): DayEntry {
  if (day.kind !== 'domingo' || !Array.isArray(day.domingoSlots)) return day;
  return { ...day, domingoSlots: day.domingoSlots.map(normalizeDomingoSlot) };
}

// Mapea el formato viejo (campos por día) al nuevo (days[]). Idempotente para el formato nuevo.
export function migrateSchedule(raw: unknown): SalidasSchedule {
  if (!raw || typeof raw !== 'object') return defaultSchedule();
  const r = raw as Record<string, unknown>;

  // Ya está en formato nuevo.
  if (Array.isArray(r.days)) {
    return {
      mes: typeof r.mes === 'string' ? r.mes : '',
      weekStart: typeof r.weekStart === 'string' ? r.weekStart : '',
      days: sortDays((r.days as DayEntry[]).map(normalizeDay)),
    };
  }

  // Formato viejo: miercoles/jueves/viernes/sabado + domingo.
  const hasLegacyKey = ['miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].some((k) => Array.isArray(r[k]));
  if (!hasLegacyKey) return defaultSchedule();

  const legacyNormal: Array<[string, number]> = [
    ['miercoles', 3],
    ['jueves', 4],
    ['viernes', 5],
    ['sabado', 6],
  ];
  const days: DayEntry[] = [];
  for (const [key, dow] of legacyNormal) {
    const slots = Array.isArray(r[key]) ? (r[key] as SalidaSlot[]) : [];
    days.push({ id: uid(), dow, kind: 'normal', slots, domingoSlots: [] });
  }
  const dom = Array.isArray(r.domingo) ? r.domingo.map(normalizeDomingoSlot) : [emptyDomingo()];
  days.push({ id: uid(), dow: 0, kind: 'domingo', slots: [], domingoSlots: dom });

  // Si nada matcheó, caer a la plantilla.
  if (days.every((d) => d.slots.length === 0 && d.domingoSlots.length === 0)) return defaultSchedule();

  return {
    mes: typeof r.mes === 'string' ? r.mes : '',
    weekStart: typeof r.weekStart === 'string' ? r.weekStart : '',
    days: sortDays(days),
  };
}

export function loadSchedule(): SalidasSchedule {
  if (typeof localStorage === 'undefined') return defaultSchedule();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSchedule();
    return migrateSchedule(JSON.parse(raw));
  } catch {
    return defaultSchedule();
  }
}

export function saveSchedule(s: SalidasSchedule): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage lleno / no disponible — ignorar
  }
}
