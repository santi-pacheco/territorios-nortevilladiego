import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useServiceWeek, type ServiceMeetingRow } from '@territorios/data';
import { AccountButton } from '../../shell/AccountSheet';
import { ScreenSkeleton } from '../../shell/AppShell';
import {
  DAY_NAME,
  DAY_SLUGS,
  WEEK_ORDER,
  addDaysIso,
  dateOfDow,
  longDate,
  mondayOf,
  slugToDow,
  fromIso,
} from '../../lib/week';
import { DayStrip } from './DayStrip';
import { StationLine } from './StationLine';

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SalidasScreen() {
  const now = useNow();
  const { dia } = useParams();
  const navigate = useNavigate();
  const thisMonday = mondayOf(now);
  const [monday, setMonday] = useState(thisMonday);
  const week = useServiceWeek(monday);

  const byDow = useMemo(() => {
    const map = new Map<number, ServiceMeetingRow[]>();
    for (const m of week.data?.meetings ?? []) {
      const list = map.get(m.dow) ?? [];
      list.push(m);
      map.set(m.dow, list);
    }
    return map;
  }, [week.data]);

  const days = WEEK_ORDER.filter((d) => byDow.has(d));
  const isThisWeek = monday === thisMonday;
  const todayDow = now.getDay();
  const fromRoute = slugToDow(dia);
  const selected =
    fromRoute !== null && byDow.has(fromRoute)
      ? fromRoute
      : isThisWeek && byDow.has(todayDow)
        ? todayDow
        : // After today's salidas are over, the next day with salidas leads.
          (days.find((d) => isThisWeek && (d + 6) % 7 > (todayDow + 6) % 7) ?? days[0] ?? null);

  const selectedDate = selected === null ? null : dateOfDow(monday, selected);
  const isToday = isThisWeek && selected === todayDow;

  function selectDay(dow: number) {
    navigate(`/salidas/${DAY_SLUGS[dow]}`, { replace: true });
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-secondary text-ink-soft">
              <button
                type="button"
                className="icon-btn -ml-3"
                aria-label="Semana anterior"
                onClick={() => setMonday(addDaysIso(monday, -7))}
              >
                <ChevronLeft aria-hidden size={22} />
              </button>
              <span className="flex min-w-0">
                <span className="shrink-0">Cong. Norte Villa Diego&nbsp;·&nbsp;</span>
                <span className="truncate">
                  {isThisWeek ? 'Esta semana' : 'Semana'} del {longDate(fromIso(monday))}
                </span>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Semana siguiente"
                onClick={() => setMonday(addDaysIso(monday, 7))}
              >
                <ChevronRight aria-hidden size={22} />
              </button>
            </div>
            <h1 className="mt-1 text-display font-bold">
              {selected === null || !selectedDate
                ? 'Salidas'
                : `${DAY_NAME[selected]} ${selectedDate.getDate()}`}
              {isToday && <span className="sr-only">, hoy</span>}
            </h1>
          </div>
          <div className="lg:hidden">
            <AccountButton />
          </div>
        </div>
        {days.length > 0 && (
          <DayStrip
            days={days}
            counts={byDow}
            selected={selected}
            todayDow={isThisWeek ? todayDow : null}
            onSelect={selectDay}
          />
        )}
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {week.isPending ? (
          <ScreenSkeleton />
        ) : week.isError && !week.data ? (
          <EmptyState
            title="No pudimos cargar las salidas"
            body="Revisá la conexión. Cuando vuelva, se actualizan solas."
          />
        ) : selected === null ? (
          <EmptyState
            title="Todavía no hay salidas para esta semana"
            body="Cuando los encargados las publiquen, aparecen acá al instante."
          />
        ) : (
          <StationLine
            key={`${monday}-${selected}`}
            dow={selected}
            meetings={byDow.get(selected) ?? []}
            now={isToday ? now : null}
          />
        )}
      </div>
    </main>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 py-10">
      <h2 className="text-heading font-bold">{title}</h2>
      <p className="max-w-prose text-body text-ink-soft">{body}</p>
    </div>
  );
}
