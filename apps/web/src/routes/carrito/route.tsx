import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useCartSchedule, type CartBoard } from '@territorios/data';
import { AccountButton } from '../../shell/AccountSheet';
import { ScreenSkeleton } from '../../shell/AppShell';
import { readMe, matchesMe } from '../../lib/me';
import { DAY_NAME, addDaysIso, fromIso, longDate, mondayOf, toIso } from '../../lib/week';
import { shortRange } from '../programa/model';

/** One rendered row of the schedule: a slot on a concrete date. */
interface Turn {
  date: string;
  dateObj: Date;
  weekday: string;
  timeRange: string;
  label: string | null;
  place: string;
  placeColor: string;
  people: string[];
  note: string | null;
  isBlackout: boolean;
  isMine: boolean;
}

interface WeekSection {
  weekStart: string;
  heading: string;
  turns: Turn[];
}

/** "HH:MM[:SS]" → "HH:MM"; the whole range in mono-friendly form. */
function timeRange(start: string, end: string): string {
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** Rows for every slot date inside the schedule range that has an assignment or a blackout. */
function buildWeeks(board: CartBoard, me: string): WeekSection[] {
  const { schedule, slots, assignments, blackouts, places } = board;
  if (!schedule) return [];
  const placeById = new Map(places.map((p) => [p.id, p]));
  const sortedSlots = [...slots].sort(
    (a, b) => a.iso_dow - b.iso_dow || a.start_time.localeCompare(b.start_time),
  );
  const assignmentAt = new Map(assignments.map((a) => [`${a.week_date}|${a.slot_id}`, a]));
  const blackedOut = new Set(blackouts.map((b) => `${b.date}|${b.slot_id}`));

  const sections: WeekSection[] = [];
  for (
    let weekStart = mondayOf(fromIso(schedule.start_date));
    weekStart <= schedule.end_date;
    weekStart = addDaysIso(weekStart, 7)
  ) {
    const turns: Turn[] = [];
    for (const slot of sortedSlots) {
      const date = addDaysIso(weekStart, slot.iso_dow - 1);
      if (date < schedule.start_date || date > schedule.end_date) continue;
      const isBlackout = blackedOut.has(`${date}|${slot.id}`);
      const assignment = assignmentAt.get(`${weekStart}|${slot.id}`);
      if (!isBlackout && !assignment) continue;
      const people = isBlackout ? [] : (assignment?.person_names ?? []);
      const place = placeById.get(slot.place_id);
      turns.push({
        date,
        dateObj: fromIso(date),
        weekday: DAY_NAME[slot.iso_dow % 7] ?? '',
        timeRange: timeRange(slot.start_time, slot.end_time),
        label: slot.display_label,
        place: place?.name ?? '',
        placeColor: place?.color ?? '',
        people,
        note: isBlackout ? null : (assignment?.note ?? null),
        isBlackout,
        isMine: me !== '' && people.some((name) => matchesMe(me, name)),
      });
    }
    if (turns.length === 0) continue;
    sections.push({
      weekStart,
      heading: `Semana del ${longDate(fromIso(weekStart))}`,
      turns,
    });
  }
  return sections;
}

function NameList({ people, me }: { people: string[]; me: string }) {
  return (
    <>
      {people.map((name, i) => (
        <span key={name}>
          {i > 0 && ', '}
          {me !== '' && matchesMe(me, name) ? <strong>{name}</strong> : name}
        </span>
      ))}
    </>
  );
}

function Swatch({ color }: { color: string }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 shrink-0 rounded-[3px] border border-line-strong"
      style={{ backgroundColor: color }}
    />
  );
}

function BlackoutText() {
  return <span className="text-ink-soft">Sin carrito</span>;
}

function DesktopWeekTable({ turns, me, headerH }: { turns: Turn[]; me: string; headerH: number }) {
  return (
    <table className="hidden w-full table-fixed border-separate border-spacing-0 lg:table">
      <thead>
        <tr>
          {['Día', 'Horario', 'Lugar', 'Publicadores', 'Nota'].map((col) => (
            <th
              key={col}
              scope="col"
              className="sticky border-b border-line bg-surface px-3 py-2 text-left text-body-strong font-semibold"
              style={{ top: headerH, zIndex: 5 }}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {turns.map((turn) => (
          <tr key={turn.date + turn.timeRange}>
            <td className="border-b border-line px-3 py-3 align-top">
              <div className="text-body font-semibold">{turn.weekday}</div>
              <div className="text-secondary text-ink-soft">{longDate(turn.dateObj)}</div>
            </td>
            <td className="border-b border-line px-3 py-3 align-top">
              <div className="font-mono text-body">{turn.timeRange}</div>
              {turn.label && <div className="text-secondary text-ink-soft">{turn.label}</div>}
            </td>
            <td className="border-b border-line px-3 py-3 align-top">
              <span className="flex items-center gap-2">
                <Swatch color={turn.placeColor} />
                <span className="text-body break-words">{turn.place}</span>
              </span>
            </td>
            <td className="border-b border-line px-3 py-3 align-top text-body break-words">
              {turn.isBlackout ? <BlackoutText /> : <NameList people={turn.people} me={me} />}
            </td>
            <td className="border-b border-line px-3 py-3 align-top text-secondary text-ink-soft">
              {turn.note}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MobileWeekList({ turns, me }: { turns: Turn[]; me: string }) {
  return (
    <ul className="flex flex-col border-t border-line lg:hidden">
      {turns.map((turn) => (
        <li key={turn.date + turn.timeRange} className="flex flex-col gap-1 border-b border-line py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <div>
              <span className="text-body font-semibold">{turn.weekday}</span>{' '}
              <span className="text-secondary text-ink-soft">{longDate(turn.dateObj)}</span>
            </div>
            <span className="font-mono text-body whitespace-nowrap">{turn.timeRange}</span>
          </div>
          <span className="flex items-center gap-2">
            <Swatch color={turn.placeColor} />
            <span className="text-body">{turn.place}</span>
          </span>
          {turn.label && <span className="text-secondary text-ink-soft">{turn.label}</span>}
          <span className="text-body break-words">
            {turn.isBlackout ? <BlackoutText /> : <NameList people={turn.people} me={me} />}
          </span>
          {turn.note && <span className="text-secondary text-ink-soft break-words">{turn.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function MyTurns({ turns, me }: { turns: Turn[]; me: string }) {
  return (
    <section aria-labelledby="mis-turnos" className="mb-8">
      <h2 id="mis-turnos" className="mb-1 text-heading font-bold">
        Mis turnos
      </h2>
      <ul className="flex flex-col border-t border-line">
        {turns.map((turn) => {
          const companions = turn.people.filter((name) => !matchesMe(me, name));
          return (
            <li key={turn.date + turn.timeRange} className="flex flex-col gap-1 border-b border-line py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-body font-semibold">
                  {turn.weekday} {longDate(turn.dateObj)}
                </span>
                <span className="font-mono text-body whitespace-nowrap">{turn.timeRange}</span>
              </div>
              <span className="flex items-center gap-2">
                <Swatch color={turn.placeColor} />
                <span className="text-body">{turn.place}</span>
              </span>
              {turn.label && <span className="text-secondary text-ink-soft">{turn.label}</span>}
              {companions.length > 0 && (
                <span className="text-secondary text-ink-soft break-words">
                  Con {companions.join(', ')}
                </span>
              )}
              {turn.note && <span className="text-secondary text-ink-soft break-words">{turn.note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
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

export function Component() {
  const [params, setParams] = useSearchParams();
  const board = useCartSchedule(params.get('horario') ?? undefined);
  const me = readMe();
  const [showPast, setShowPast] = useState(false);

  // The week table header sticks right under the screen header, whose height changes
  // with the caption, theme and text size; measure it instead of hardcoding.
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sections = useMemo(() => (board.data ? buildWeeks(board.data, me) : []), [board.data, me]);
  const today = toIso(new Date());
  const myTurns = useMemo(
    () =>
      sections
        .flatMap((s) => s.turns)
        .filter((t) => t.isMine && !t.isBlackout && t.date >= today),
    [sections, today],
  );
  const upcoming = sections.filter((s) => {
    const last = addDaysIso(s.weekStart, 6);
    return last >= today;
  });
  const past = sections.filter((s) => addDaysIso(s.weekStart, 6) < today);

  const schedule = board.data?.schedule;
  // Current and future schedules a member can switch between (e.g. next month, published early).
  const choices = (board.data?.schedules ?? [])
    .filter((s) => s.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <main className="flex flex-1 flex-col">
      <header ref={headerRef} className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            {/* The period never truncates; a long schedule name does. */}
            <div className="flex min-w-0 text-secondary text-ink-soft">
              {schedule && (
                <>
                  <span className="truncate">{schedule.name}</span>
                  <span className="shrink-0 whitespace-pre">
                    {' · '}
                    {shortRange(schedule.start_date, schedule.end_date)}
                  </span>
                </>
              )}
            </div>
            <h1 className="mt-1 text-display font-bold">Carrito</h1>
          </div>
          <div className="lg:hidden">
            <AccountButton />
          </div>
        </div>
        {choices.length > 1 && schedule && (
          <div className="mx-auto w-full max-w-3xl px-4 pb-3">
            <div
              className="segmented w-full"
              role="radiogroup"
              aria-label="Cronograma"
              style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
            >
              {choices.map((c) => (
                <label key={c.id} className="segmented-item">
                  <input
                    type="radio"
                    name="horario"
                    value={c.id}
                    checked={c.id === schedule.id}
                    onChange={() => setParams({ horario: c.id }, { replace: true })}
                  />
                  <span className="px-2">
                    <span className="block max-w-full truncate">{c.name}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {board.isPending ? (
          <ScreenSkeleton />
        ) : board.isError && !board.data ? (
          <EmptyState
            title="No pudimos cargar el carrito"
            body="Revisá la conexión. Cuando vuelva, se actualiza solo."
          />
        ) : !board.data?.schedule || sections.length === 0 ? (
          <EmptyState
            title="Todavía no hay turnos de carrito"
            body="Cuando los encargados publiquen el cronograma, aparece acá."
          />
        ) : (
          <>
            {myTurns.length > 0 && <MyTurns turns={myTurns} me={me} />}

            <div className="flex flex-col gap-10">
              {upcoming.map((section) => (
                <section key={section.weekStart} aria-labelledby={`sem-${section.weekStart}`}>
                  <h2 id={`sem-${section.weekStart}`} className="mb-2 text-heading font-bold">
                    {section.heading}
                  </h2>
                  <MobileWeekList turns={section.turns} me={me} />
                  <DesktopWeekTable turns={section.turns} me={me} headerH={headerH} />
                </section>
              ))}
            </div>
            {past.length > 0 && (
              <>
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center justify-center gap-2"
                    aria-expanded={showPast}
                    onClick={() => setShowPast((v) => !v)}
                  >
                    {showPast ? (
                      <>
                        <ChevronUp aria-hidden size={20} />
                        Ocultar semanas anteriores
                      </>
                    ) : (
                      <>
                        <ChevronDown aria-hidden size={20} />
                        Ver semanas anteriores
                      </>
                    )}
                  </button>
                </div>
                {showPast && (
                  <div className="mt-8 flex flex-col gap-10">
                    {past.map((section) => (
                      <section key={section.weekStart} aria-labelledby={`sem-${section.weekStart}`}>
                        <h2 id={`sem-${section.weekStart}`} className="mb-2 text-heading font-bold">
                          {section.heading}
                        </h2>
                        <MobileWeekList turns={section.turns} me={me} />
                        <DesktopWeekTable turns={section.turns} me={me} headerH={headerH} />
                      </section>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
