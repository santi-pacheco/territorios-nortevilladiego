/**
 * Turns per person, alphabetical, live with the preview. Tap a name to light up its turns.
 * Beside the table on wide screens; a collapsible section below it on narrow ones.
 */
import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown } from 'lucide-react';
import type { Participation, ParticipationFlag } from './edit';

const FLAG_TEXT: Record<Exclude<ParticipationFlag, null>, string> = {
  zero: 'Sin turnos',
  high: 'Muchos',
  low: 'Pocos',
};

export function ParticipationPanel({
  data,
  highlight,
  onHighlight,
}: {
  data: Participation;
  highlight: string | null;
  onHighlight: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const flagged = data.rows.filter((r) => r.flag !== null).length;
  return (
    <section
      aria-labelledby="carrito-participacion-h"
      className="flex flex-col gap-2 min-[1700px]:sticky min-[1700px]:top-4 min-[1700px]:max-h-[calc(100dvh-2rem)] min-[1700px]:overflow-y-auto"
    >
      <h3 id="carrito-participacion-h" className="text-heading font-bold">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-h-touch w-full items-center justify-between gap-2 text-left min-[1700px]:pointer-events-none min-[1700px]:min-h-0"
          onClick={() => setOpen((o) => !o)}
        >
          Turnos por persona
          <ChevronDown
            aria-hidden
            size={24}
            className={`shrink-0 transition-transform min-[1700px]:hidden ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </h3>
      <div className={`${open ? 'flex' : 'hidden'} flex-col gap-2 min-[1700px]:flex`}>
        <p className="text-secondary text-ink-soft">
          {data.rows.length === 0
            ? 'Todavía no hay personas.'
            : `Promedio ${data.mean.toFixed(1).replace('.', ',')} entre quienes tienen turnos${
                flagged > 0 ? `; ${flagged} para revisar` : ''
              }. Tocá un nombre para ver sus turnos.`}
        </p>
        <ul className="grid border-t border-line sm:grid-cols-2 sm:gap-x-6 min-[1700px]:grid-cols-1">
          {data.rows.map((row) => {
            const active = highlight === row.id;
            return (
              <li key={row.id} className="border-b border-line">
                <button
                  type="button"
                  aria-pressed={active}
                  className={`flex min-h-touch w-full items-center justify-between gap-3 px-1 text-left ${
                    active ? 'bg-canvas font-bold' : ''
                  }`}
                  onClick={() => onHighlight(active ? null : row.id)}
                >
                  <span className="min-w-0 break-words text-body">{row.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {row.flag && (
                      <span
                        className={`inline-flex items-center gap-1 text-caption ${
                          row.flag === 'zero' ? 'text-danger' : 'text-warn'
                        }`}
                      >
                        {row.flag === 'zero' && <AlertTriangle aria-hidden size={16} />}
                        {row.flag === 'high' && <ArrowUp aria-hidden size={16} />}
                        {row.flag === 'low' && <ArrowDown aria-hidden size={16} />}
                        {FLAG_TEXT[row.flag]}
                      </span>
                    )}
                    <span className="font-mono text-body font-semibold">{row.count}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
