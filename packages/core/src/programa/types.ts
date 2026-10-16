// Programa semanal: datos extraídos de los PDF mensuales de JW.org.
// Las claves son fechas ISO (YYYY-MM-DD) para poder fusionar meses sin pisarse.

export type MidweekSection = 'inicio' | 'tesoros' | 'maestros' | 'vida';

export interface ProgramaPerson {
  name: string;
  role?: string; // "Presidente" | "Lector" | "Conductor"
}

export interface MidweekPart {
  time: string; // "19:06"
  title: string;
  section: MidweekSection;
  people: ProgramaPerson[];
}

export interface MidweekWeek {
  date: string; // martes ISO
  asamblea: string | null;
  parts: MidweekPart[];
}

export interface WeekendDiscourse {
  tipo: string; // "PÚBLICO" | "ESPECIAL"
  titulo: string;
  orador: string | null;
  congregacion: string | null;
  saliente: string | null;
}

export interface WeekendMeeting {
  date: string; // sábado ISO
  asamblea: string | null;
  presidente: string | null;
  cancionInicio: string | null;
  conductor: string | null;
  lector: string | null;
  cancionFin: string | null;
  oracionFinal: string | null;
  discurso: WeekendDiscourse | null;
}

export interface ProgramaData {
  midweek: Record<string, MidweekWeek>;
  weekend: Record<string, WeekendMeeting>;
}

export const EMPTY_PROGRAMA: ProgramaData = { midweek: {}, weekend: {} };

// Un fragmento de texto del PDF con su posición (pts, origen abajo-izquierda).
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  font: string;
}
