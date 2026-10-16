/** Main-thread wrapper around the scheduler worker: one request, one response, then terminate. */
import SchedulerWorker from './scheduler.worker?worker';
import type { SchedulerRequest, SchedulerResponse } from './scheduler.worker';

export type SchedulerSuccess = Extract<SchedulerResponse, { ok: true }>;

export function runScheduler(req: SchedulerRequest): Promise<SchedulerSuccess> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new SchedulerWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    worker.onmessage = (event: MessageEvent<SchedulerResponse>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'El generador falló.'));
    };
    worker.postMessage(req);
  });
}
