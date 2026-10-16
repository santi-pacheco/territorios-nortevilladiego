import type { CarritoData, Place, TimeSlot, Person } from './types';

export const STORAGE_KEY = 'carrito-data';

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function newId(): string {
  return uid();
}

const DEFAULT_PLACES: Place[] = [
  { id: 'place-romar', name: 'ROMAR', color: '#f5c842' },
  { id: 'place-plaza', name: 'PLAZA LA CURVA', color: '#4db6ac' },
];

const DEFAULT_SLOTS: TimeSlot[] = [
  { id: 'slot-mar-romar',  placeId: 'place-romar', dayOfWeek: 2, startTime: '09:00', endTime: '11:00', groupSize: 3 },
  { id: 'slot-mie-plaza',  placeId: 'place-plaza', dayOfWeek: 3, startTime: '16:30', endTime: '18:00', groupSize: 3 },
  { id: 'slot-jue-romar1', placeId: 'place-romar', dayOfWeek: 4, startTime: '08:30', endTime: '09:30', groupSize: 3 },
  { id: 'slot-jue-romar2', placeId: 'place-romar', dayOfWeek: 4, startTime: '09:30', endTime: '11:00', groupSize: 3 },
  { id: 'slot-jue-plaza',  placeId: 'place-plaza', dayOfWeek: 4, startTime: '16:30', endTime: '18:00', groupSize: 3 },
  { id: 'slot-vie-romar',  placeId: 'place-romar', dayOfWeek: 5, startTime: '09:00', endTime: '11:00', groupSize: 3 },
];

// Seed ficticio: nombres inventados, nunca personas reales.
const P = {
  CUATRO: 'p-persona-cuatro',
  CINCO: 'p-persona-cinco',
};

const DEFAULT_PEOPLE: Person[] = [
  { id: 'p-persona-uno',   name: 'Persona Uno',   gender: 'F', availableSlotIds: ['slot-mar-romar', 'slot-vie-romar'],                    mustBeWithIds: [],         targetAppearances: 2 },
  { id: 'p-persona-dos',   name: 'Persona Dos',   gender: 'F', availableSlotIds: ['slot-mar-romar', 'slot-jue-romar1', 'slot-vie-romar'],  mustBeWithIds: [],         targetAppearances: 2 },
  { id: 'p-persona-tres',  name: 'Persona Tres',  gender: 'M', availableSlotIds: ['slot-mie-plaza', 'slot-jue-plaza'],                     mustBeWithIds: [],         targetAppearances: 2 },
  { id: P.CUATRO,          name: 'Persona Cuatro', gender: 'M', availableSlotIds: ['slot-mar-romar'],                                      mustBeWithIds: [P.CINCO],  targetAppearances: 2 },
  { id: P.CINCO,           name: 'Persona Cinco', gender: 'F', availableSlotIds: ['slot-mar-romar'],                                       mustBeWithIds: [P.CUATRO], targetAppearances: 2 },
  { id: 'p-persona-seis',  name: 'Persona Seis',  gender: 'F', availableSlotIds: ['slot-mie-plaza', 'slot-jue-plaza', 'slot-vie-romar'],   mustBeWithIds: [],         targetAppearances: 2 },
  { id: 'p-persona-siete', name: 'Persona Siete', gender: 'F', availableSlotIds: ['slot-jue-romar1', 'slot-jue-romar2'],                   mustBeWithIds: [],         targetAppearances: 2 },
  { id: 'p-persona-ocho',  name: 'Persona Ocho',  gender: 'M', availableSlotIds: ['slot-jue-romar2', 'slot-mie-plaza'],                    mustBeWithIds: [],         targetAppearances: 2 },
];

export function defaultData(): CarritoData {
  return {
    places: DEFAULT_PLACES,
    slots: DEFAULT_SLOTS,
    people: DEFAULT_PEOPLE,
    schedule: null,
    blackouts: [],
  };
}

export function loadData(): CarritoData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw) as Partial<CarritoData> | null;
    if (!parsed || typeof parsed !== 'object') return defaultData();
    return {
      places: Array.isArray(parsed.places) ? parsed.places : DEFAULT_PLACES,
      slots: Array.isArray(parsed.slots) ? parsed.slots : DEFAULT_SLOTS,
      people: Array.isArray(parsed.people) ? parsed.people : DEFAULT_PEOPLE,
      schedule: parsed.schedule ?? null,
      blackouts: Array.isArray(parsed.blackouts) ? parsed.blackouts : [],
    };
  } catch {
    return defaultData();
  }
}

export function saveData(data: CarritoData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore (private browsing / storage full) */
  }
}
