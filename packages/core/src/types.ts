import type { Feature, Polygon, MultiPolygon } from 'geojson';

export type TerritoryGeometry = Polygon | MultiPolygon;

export interface Territory {
  id: number;
  feature: Feature<TerritoryGeometry, { id: number; name: string }>;
  centroid: [number, number];
}

export interface Assignment {
  uid: string;
  time: string;
  corner: string;
  groups: string;
  leader: string;
  territoryIds: number[];
}

export interface DaySchedule {
  key: string;
  label: string;
  short: string;
  date?: string;
  dow?: number; // JS getDay value if known (0..6)
  assignments: Assignment[];
}

export interface ScheduleData {
  weekLabel: string | null;
  days: DaySchedule[];
}

export interface GeocodedPoint {
  corner: string;
  lat: number;
  lng: number;
}

// --- Salidas card (ModeloNuevo) ---

export interface SalidaSlot {
  id: string;
  hora: string;
  grupos: string;
  conductor: string;
  lugar: string;
  territorio: string;
}

export interface DomingoSlot {
  id: string;
  hora: string;
  grupos: string;
  conductor: string;
  lugar: string;
  territorioNumero: string;
}

export type DayKind = 'normal' | 'domingo';

export interface DayEntry {
  id: string;
  dow: number;                 // 0..6 (Dom..Sáb): define nombre, color y número
  kind: DayKind;               // 'domingo' preserva G1–G4; el resto 'normal'
  slots: SalidaSlot[];         // usado cuando kind === 'normal'
  domingoSlots: DomingoSlot[]; // usado cuando kind === 'domingo'
}

export interface SalidasSchedule {
  mes: string;
  weekStart?: string; // fecha de referencia (el Miércoles); los números derivan de ella
  days: DayEntry[];   // ordenados Lun→Dom
}
