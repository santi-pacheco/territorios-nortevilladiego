export interface Place {
  id: string;
  name: string;
  color: string;
}

export interface TimeSlot {
  id: string;
  placeId: string;
  dayOfWeek: number; // ISO: 1=Lun ... 7=Dom
  startTime: string; // "08:30"
  endTime: string;
  groupSize: number;
  displayLabel?: string; // optional override of the schedule header text
}

export interface Person {
  id: string;
  name: string;
  gender: 'M' | 'F';
  availableSlotIds: string[];
  mustBeWithIds: string[];
  targetAppearances: number;
}

export interface ScheduleEntry {
  weekLabel: string; // "4 de mayo"
  weekDate: string;  // ISO date of the Monday of that week
  slotId: string;
  personIds: string[];
  note?: string;
}

export interface ScheduleConfig {
  name: string;
  startDate: string;
  endDate: string;
  entries: ScheduleEntry[];
}

export interface SlotBlackout {
  id: string;
  slotId: string;
  date: string; // ISO "YYYY-MM-DD" — the specific day this slot is cancelled
}

export interface CarritoData {
  places: Place[];
  slots: TimeSlot[];
  people: Person[];
  schedule: ScheduleConfig | null;
  blackouts: SlotBlackout[];
}
