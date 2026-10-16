import { useEffect, useRef } from 'react';
import type { ServiceMeetingRow } from '@territorios/data';
import { conflictRows, type MeetingPatch } from './conflict';

export interface ConflictState {
  id: string;
  /** The patch this editor tried to save. */
  patch: MeetingPatch;
  /** The row as it stands on the server (null = deleted / no longer visible). */
  current: ServiceMeetingRow | null;
}

interface Props {
  conflict: ConflictState;
  pending?: boolean;
  /** Keep their version: close and show the refetched row. */
  onUseTheirs: () => void;
  /** Re-apply our patch on the new version. */
  onKeepMine: () => void;
}

/** Inline sheet shown when a save hits a compare-and-swap conflict. */
export function ConflictSheet({ conflict, pending, onUseTheirs, onKeepMine }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const rows = conflictRows(conflict.patch, conflict.current);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="conflict-title"
      onCancel={(e) => {
        e.preventDefault();
        onUseTheirs();
      }}
    >
      <h2 id="conflict-title" className="text-heading font-bold">
        Alguien cambió esta salida
      </h2>

      {conflict.current === null ? (
        <>
          <p className="mt-2 max-w-prose text-body text-ink-soft">
            Otra persona la borró mientras la editabas. Tu cambio no se guardó.
          </p>
          <div className="mt-5 flex justify-end">
            <button type="button" className="btn-primary" onClick={onUseTheirs}>
              Entendido
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-prose text-body text-ink-soft">
            Otra persona la guardó antes que vos. Elegí qué queda.
          </p>

          <table className="mt-4 w-full text-secondary">
            <thead>
              <tr className="text-left text-ink-soft">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Campo
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Tu versión
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Su versión
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-line align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-semibold text-ink">
                    {row.label}
                  </th>
                  <td className="py-2 pr-3 break-words">{row.yours}</td>
                  <td className="py-2 break-words">{row.theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn-secondary" onClick={onUseTheirs} disabled={pending}>
              Usar lo de ellos
            </button>
            <button type="button" className="btn-primary" onClick={onKeepMine} disabled={pending}>
              {pending ? 'Guardando…' : 'Guardar lo mío'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
