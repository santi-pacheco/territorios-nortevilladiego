import { Navigation, X } from 'lucide-react';
import type { MeetingUse } from './model';

interface Props {
  territoryId: number;
  /** "Jueves 15"; null when the week has no salidas. */
  dayLabel: string | null;
  uses: MeetingUse[];
  directions: string;
  onClose: () => void;
}

/** Body of the territory sheet. Plain JSX text only: meeting data is never parsed as HTML. */
export function TerritorySheet({ territoryId, dayLabel, uses, directions, onClose }: Props) {
  const external = directions.startsWith('http');
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {dayLabel && (
            <p className="text-secondary text-ink-soft">
              {dayLabel} · {uses.length} {uses.length === 1 ? 'salida' : 'salidas'}
            </p>
          )}
          <h2 id="territory-title" className="mt-1 flex items-center gap-3 text-heading font-bold">
            <span className="roundel">{territoryId}</span>
            Territorio {territoryId}
          </h2>
        </div>
        <button type="button" className="icon-btn -mr-2" aria-label="Cerrar" onClick={onClose}>
          <X aria-hidden size={24} />
        </button>
      </div>

      {uses.length === 0 ? (
        <p className="text-body text-ink-soft">
          {dayLabel
            ? `Este día no hay salidas en el territorio ${territoryId}.`
            : 'Esta semana todavía no hay salidas publicadas.'}
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {uses.map(({ meeting: m, groups }) => (
            <li key={m.id} className="flex gap-4 py-3">
              <time className="min-w-14 shrink-0 font-mono text-body font-bold">
                {m.start_time || 'Sin hora'}
              </time>
              <div className="min-w-0">
                <p className="text-body font-semibold break-words">
                  {m.place || 'Lugar a confirmar'}
                </p>
                {(m.conductor || groups.length > 0) && (
                  <p className="text-secondary text-ink-soft break-words">
                    {m.conductor && <>Conduce {m.conductor}</>}
                    {m.conductor && groups.length > 0 && ' · '}
                    {groups.join(', ')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <a
        href={directions}
        className="btn-primary flex items-center justify-center gap-2 no-underline"
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        <Navigation aria-hidden size={22} />
        Cómo llegar
      </a>
    </div>
  );
}
