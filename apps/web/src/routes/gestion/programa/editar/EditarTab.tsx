/**
 * Gestión ▸ Programa ▸ Editar: the manual program editor.
 *
 * A month picker over the weeks of that month; each week expands into the midweek and weekend
 * editors (see `WeekSection`). The week containing today opens by default.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { mondayOf } from '../../../../lib/week';
import { monthLabel, shiftMonth, weekStartsOfMonth } from './model';
import { WeekSection } from './WeekSection';

export function EditarPrograma() {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  const weeks = useMemo(() => weekStartsOfMonth(cursor.year, cursor.month), [cursor]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mes anterior"
          onClick={() => setCursor((c) => shiftMonth(c.year, c.month, -1))}
        >
          <ChevronLeft aria-hidden size={24} />
        </button>
        <p className="text-heading font-bold capitalize" aria-live="polite">
          {monthLabel(cursor.year, cursor.month)}
        </p>
        <button
          type="button"
          className="icon-btn"
          aria-label="Mes siguiente"
          onClick={() => setCursor((c) => shiftMonth(c.year, c.month, 1))}
        >
          <ChevronRight aria-hidden size={24} />
        </button>
      </div>

      <p className="max-w-prose text-body text-ink-soft">
        Elegí una semana para cargar o corregir sus reuniones a mano.
      </p>

      <ul className="flex flex-col gap-3">
        {weeks.map((weekStart) => (
          <li key={weekStart}>
            <WeekSection weekStart={weekStart} defaultOpen={weekStart === thisMonday} />
          </li>
        ))}
      </ul>
    </div>
  );
}
