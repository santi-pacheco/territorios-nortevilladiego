import { useRef, type KeyboardEvent } from 'react';
import type { ServiceMeetingRow } from '@territorios/data';
import { DAY_NAME, DAY_SHORT, DAY_TOKEN } from '../../lib/week';

interface Props {
  days: number[];
  counts: Map<number, ServiceMeetingRow[]>;
  selected: number | null;
  todayDow: number | null;
  onSelect: (dow: number) => void;
}

/** Day tabs, each carrying its line colour and one tick per salida (the day's extent). */
export function DayStrip({ days, counts, selected, todayDow, onSelect }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + days.length) % days.length;
    refs.current[next]?.focus();
    onSelect(days[next]!);
  }

  return (
    <div
      role="tablist"
      aria-label="Días de salida"
      className="mx-auto mt-2 flex w-full max-w-3xl gap-1 overflow-x-auto px-2"
    >
      {days.map((dow, i) => {
        const on = dow === selected;
        const n = counts.get(dow)?.length ?? 0;
        return (
          <button
            key={dow}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            aria-label={`${DAY_NAME[dow]}${dow === todayDow ? ', hoy' : ''}, ${n} ${n === 1 ? 'salida' : 'salidas'}`}
            onClick={() => onSelect(dow)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="day-tab"
            style={{ '--day': `var(--tk-day-${DAY_TOKEN[dow]}-accent)` } as React.CSSProperties}
          >
            <span aria-hidden className="day-tab-swatch" />
            <span className="day-tab-label">{DAY_SHORT[dow]}</span>
            <span aria-hidden className="day-tab-ticks">
              {Array.from({ length: Math.min(n, 6) }, (_, k) => (
                <i key={k} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
