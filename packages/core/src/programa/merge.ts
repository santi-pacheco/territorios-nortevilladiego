import type { ProgramaData } from './types';

// Fusiona un PDF nuevo con lo guardado. Las claves son fechas: un mes no borra al otro
// (la semana del 28 sep–4 oct mezcla el PDF de septiembre con el de octubre).
// Si la misma fecha vuelve a llegar, gana lo que se acaba de subir.
export function mergeProgramaData(base: ProgramaData, incoming: Partial<ProgramaData>): ProgramaData {
  return {
    midweek: { ...base.midweek, ...(incoming.midweek ?? {}) },
    weekend: { ...base.weekend, ...(incoming.weekend ?? {}) },
  };
}
