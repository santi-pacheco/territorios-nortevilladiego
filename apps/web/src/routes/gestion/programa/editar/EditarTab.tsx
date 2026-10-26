/**
 * Gestión ▸ Programa ▸ Editar: the manual program editor for one meeting.
 *
 * A month picker over the weeks of that month; each week expands into the editor of `part`
 * only (see `WeekSection`). The week containing today opens by default.
 *
 * "Traer el mes" fetches the Guía de actividades for every week of the month once and hands each
 * week its part; each week then shows its own proposal to apply and save. The Guía belongs to the
 * midweek meeting, so the button only appears in that tab.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { loadWorkbook, WorkbookError } from '@territorios/data';
import { mondayOf } from '../../../../lib/week';
import { PART_LABEL, type ProgramaPart } from '../access';
import { monthLabel, shiftMonth, weekLabel, weekStartsOfMonth } from './model';
import type { GuideDelivery } from './guide';
import { WeekSection } from './WeekSection';

export function EditarPrograma({ part }: { part: ProgramaPart }) {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  const weeks = useMemo(() => weekStartsOfMonth(cursor.year, cursor.month), [cursor]);

  const [guides, setGuides] = useState<Record<string, GuideDelivery>>({});
  const [fetchingMonth, setFetchingMonth] = useState(false);
  const [monthNote, setMonthNote] = useState<string | null>(null);

  function moveMonth(delta: number) {
    setCursor((c) => shiftMonth(c.year, c.month, delta));
    setGuides({});
    setMonthNote(null);
  }

  async function fetchMonth() {
    setFetchingMonth(true);
    setMonthNote(null);
    const month = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}`;
    try {
      const res = await loadWorkbook({ month });
      const nonce = Date.now();
      const next: Record<string, GuideDelivery> = {};
      for (const weekStart of weeks) {
        next[weekStart] = { week: res.weeks.find((w) => w.weekStart === weekStart) ?? null, nonce };
      }
      setGuides(next);
      const missing = weeks.filter((w) => !next[w]?.week);
      setMonthNote(
        res.weeks.length === 0
          ? 'La Guía de este mes todavía no está publicada. Cargá el mes a mano.'
          : `Trajimos la Guía de ${res.weeks.length === 1 ? 'una semana' : `${res.weeks.length} semanas`}. Revisá los cambios de cada una y guardala.` +
              (missing.length ? ` Sin Guía todavía: ${missing.map(weekLabel).join(', ')}.` : ''),
      );
    } catch (err) {
      setMonthNote(
        err instanceof WorkbookError && err.status === 403
          ? 'No tenés permiso para traer la Guía.'
          : 'No pudimos traer la Guía de este mes. Probá de nuevo o cargala a mano.',
      );
    } finally {
      setFetchingMonth(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mes anterior"
          onClick={() => moveMonth(-1)}
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
          onClick={() => moveMonth(1)}
        >
          <ChevronRight aria-hidden size={24} />
        </button>
      </div>

      <p className="max-w-prose text-body text-ink-soft">
        Elegí una semana para cargar o corregir la reunión de {PART_LABEL[part].toLowerCase()} a
        mano
        {part === 'midweek'
          ? ', o traé la estructura de la Guía de actividades y completá solo los nombres.'
          : '.'}
      </p>

      {part === 'midweek' && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={fetchingMonth}
            onClick={fetchMonth}
          >
            {fetchingMonth ? 'Trayendo el mes…' : 'Traer el mes de la Guía de actividades'}
          </button>
          {monthNote && (
            <p role="status" className="max-w-prose text-secondary text-ink-soft">
              {monthNote}
            </p>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {weeks.map((weekStart) => (
          <li key={weekStart}>
            <WeekSection
              part={part}
              weekStart={weekStart}
              defaultOpen={weekStart === thisMonday}
              guide={part === 'midweek' ? (guides[weekStart] ?? null) : null}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
