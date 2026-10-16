/**
 * Carrito scheduler worker.
 *
 * Runs `generateSchedule` off the main thread so a long range does not freeze the
 * screen. The seed is always explicit, so "Generar" is reproducible from the preview.
 */
import {
  generateSchedule,
  type Person,
  type Place,
  type ScheduleEntry,
  type SlotBlackout,
  type TimeSlot,
} from '@territorios/core';

export interface SchedulerRequest {
  people: Person[];
  slots: TimeSlot[];
  places: Place[];
  blackouts: SlotBlackout[];
  name: string;
  startDate: string;
  endDate: string;
  /** Omit to draw a fresh one; the response echoes the seed actually used. */
  seed?: number;
}

export type SchedulerResponse =
  | { ok: true; entries: ScheduleEntry[]; warnings: string[]; seed: number }
  | { ok: false; error: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<SchedulerRequest>) => void) | null;
  postMessage: (data: SchedulerResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const req = event.data;
  const seed = req.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  try {
    const result = generateSchedule(
      req.people,
      req.slots,
      req.startDate,
      req.endDate,
      req.name,
      req.blackouts,
      { seed, places: req.places },
    );
    scope.postMessage({
      ok: true,
      entries: result.config.entries,
      warnings: result.warnings,
      seed,
    });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
