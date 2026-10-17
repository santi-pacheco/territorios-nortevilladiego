import { Suspense, lazy, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useServiceWeek, type ServiceMeetingRow } from '@territorios/data';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { ScreenSkeleton } from '../../shell/AppShell';
import {
  DAY_NAME,
  DAY_SLUGS,
  WEEK_ORDER,
  addDaysIso,
  dateOfDow,
  mondayOf,
  slugToDow,
} from '../../lib/week';
import { DayStrip } from './DayStrip';
import { shortRange } from '../programa/model';
import { StationLine } from './StationLine';
import { NextAssignment } from './NextAssignment';
import { ShareWeekButton } from './ShareWeekButton';

// Desktop splits Salidas with the day's map. The pane is a separate chunk (it carries maplibre),
// requested only once the wide layout is actually shown.
const DayMap = lazy(() => import('../mapa/DayMap'));
const WIDE = '(min-width: 64rem)';

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(WIDE);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => matchMedia(WIDE).matches,
  );
}

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
  const wide = useWide();

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

  const dayKey = `${monday}-${selected}`;
  const split = wide && selected !== null;
  const [hoverId, setHoverId] = useState<string | null>(null);
  // A roundel click belongs to the day it was made on; changing day drops it.
  const [pick, setPick] = useState<{ ids: number[]; n: number; dayKey: string } | null>(null);
  const dayPick = pick?.dayKey === dayKey ? pick : null;
  const showInPane = (ids: number[]) => setPick({ ids, n: (pick?.n ?? 0) + 1, dayKey });

  function selectDay(dow: number) {
    navigate(`/salidas/${DAY_SLUGS[dow]}`, { replace: true });
  }

  return (
    <main
      className={`salidas-split flex flex-1 flex-col ${split ? 'lg:grid lg:grid-cols-[420px_minmax(0,1fr)]' : ''}`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface">
          <ScreenHeader
            caption={
              <>
                Cong. Norte Villa Diego · {isThisWeek ? 'Esta semana' : 'Semana'}{' '}
                <span className="whitespace-nowrap">{shortRange(monday, addDaysIso(monday, 6))}</span>
              </>
            }
            title={
              <>
                {selected === null || !selectedDate
                  ? 'Salidas'
                  : `${DAY_NAME[selected]} ${selectedDate.getDate()}`}
                {isToday && <span className="sr-only">, hoy</span>}
              </>
            }
            onPrev={() => setMonday(addDaysIso(monday, -7))}
            onNext={() => setMonday(addDaysIso(monday, 7))}
          />
          {(week.data?.meetings.length ?? 0) > 0 && (
            <div className="mx-auto flex w-full max-w-3xl justify-end px-4 pt-2">
              <ShareWeekButton monday={monday} meetings={week.data!.meetings} />
            </div>
          )}
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
          <NextAssignment />
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
              key={dayKey}
              dow={selected}
              meetings={byDow.get(selected) ?? []}
              now={isToday ? now : null}
              onHover={wide ? setHoverId : undefined}
              onShow={wide ? showInPane : undefined}
            />
          )}
        </div>
      </div>

      {split && (
        <aside className="salidas-map" aria-label="Mapa del día">
          <Suspense fallback={<div aria-hidden className="skeleton h-full w-full rounded-none" />}>
            <DayMap
              dow={selected}
              meetings={byDow.get(selected) ?? []}
              dayKey={dayKey}
              hoverId={hoverId}
              pick={dayPick}
            />
          </Suspense>
        </aside>
      )}
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
