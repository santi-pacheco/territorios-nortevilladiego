import { useSearchParams } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useProgramWeek } from '@territorios/data';
import { weekRangeLabel, type MidweekWeek, type WeekendMeeting } from '@territorios/core';
import { AccountButton } from '../../shell/AccountSheet';
import { readMe } from '../../lib/me';
import { addDaysIso, fromIso, mondayOf } from '../../lib/week';
import {
  SECTION_COLOR,
  SECTION_LABEL,
  dayHeading,
  groupParts,
  midweekHasContent,
  myParts,
  parseSemanaParam,
  sanitizeMidweek,
  sanitizeWeekend,
  weekendHasContent,
  type MyPart,
} from './model';

const EMPTY_TITLE = 'El programa de esta semana todavía no se cargó';
const EMPTY_BODY = 'Cuando los encargados lo publiquen, aparece acá enseguida.';

export function Component() {
  const [params, setParams] = useSearchParams();
  const thisMonday = mondayOf(new Date());
  const monday = parseSemanaParam(params.get('semana'), fromIso(thisMonday));
  const isThisWeek = monday === thisMonday;
  const me = readMe();

  const week = useProgramWeek(monday);

  const midweek = week.data?.midweek
    ? sanitizeMidweek(week.data.midweek.data, week.data.midweek.date)
    : null;
  const weekend = week.data?.weekend
    ? sanitizeWeekend(week.data.weekend.data, week.data.weekend.date)
    : null;

  const parts = myParts(midweek, weekend, me);

  const asamblea = weekend?.asamblea ?? midweek?.asamblea ?? null;
  const onlyAssembly =
    asamblea !== null && (!midweek || !midweekHasContent(midweek)) && (!weekend || !weekendHasContent(weekend));

  function shiftWeek(deltaDays: number) {
    const next = addDaysIso(monday, deltaDays);
    setParams(next === thisMonday ? {} : { semana: next }, { replace: true });
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-secondary text-ink-soft">
              <button
                type="button"
                className="icon-btn -ml-3"
                aria-label="Semana anterior"
                onClick={() => shiftWeek(-7)}
              >
                <ChevronLeft aria-hidden size={22} />
              </button>
              <span className="truncate">
                {isThisWeek ? 'Esta semana · ' : 'Semana '}
                {weekRangeLabel(monday)}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Semana siguiente"
                onClick={() => shiftWeek(7)}
              >
                <ChevronRight aria-hidden size={22} />
              </button>
            </div>
            <h1 className="mt-1 text-display font-bold">Programa</h1>
          </div>
          <div className="lg:hidden">
            <AccountButton />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {week.isPending ? (
          <WeekSkeleton />
        ) : week.isError && !week.data ? (
          <EmptyState
            level={2}
            title="No pudimos cargar el programa"
            body="Revisá la conexión. Cuando vuelva, se actualiza solo."
          />
        ) : (
          <>
            {!isThisWeek && (
              <div className="mb-8 flex justify-center">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2"
                  onClick={() => setParams({}, { replace: true })}
                >
                  <CalendarDays aria-hidden size={20} />
                  Ir a esta semana
                </button>
              </div>
            )}

            {onlyAssembly && asamblea ? (
              <AssemblyCard name={asamblea} caption={weekRangeLabel(monday)} />
            ) : (
              <div className="flex flex-col gap-10">
                {parts.length > 0 && <MyParts parts={parts} />}
                <MidweekSection week={midweek} fallbackDate={addDaysIso(monday, 1)} />
                <WeekendSection meeting={weekend} fallbackDate={addDaysIso(monday, 5)} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function MyParts({ parts }: { parts: MyPart[] }) {
  return (
    <section aria-labelledby="mis-partes">
      <h2 id="mis-partes" className="mb-1 text-heading font-bold">
        Mis partes
      </h2>
      <ul className="flex flex-col border-t border-line">
        {parts.map((part) => (
          <li
            key={part.key}
            className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-body font-semibold">{part.day}</span>
              {part.time && (
                <time className="font-mono text-body whitespace-nowrap">{part.time}</time>
              )}
            </div>
            <span className="text-body break-words">{part.title}</span>
            {part.role && <span className="text-secondary text-ink-soft">{part.role}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Assembly weeks replace the whole body with one card; a meeting that is only an
 *  assembly note gets the same card inside its own section. */
function AssemblyCard({ name, caption }: { name: string; caption: string }) {
  return (
    <section className="rounded-[10px] border border-line bg-surface px-4 py-10 text-center">
      <p className="text-secondary text-ink-soft">{caption}</p>
      <h2 className="mt-1 text-title font-bold break-words">{name}</h2>
      <p className="mx-auto mt-3 max-w-prose text-body text-ink-soft">
        Esta semana no hay partes: las reuniones son en la asamblea.
      </p>
    </section>
  );
}

function MeetingHeading({ id, title, date }: { id: string; title: string; date: string }) {
  return (
    <div className="mb-2">
      <h2 id={id} className="text-heading font-bold">
        {title}
      </h2>
      <p className="text-secondary text-ink-soft">{date}</p>
    </div>
  );
}

function MidweekSection({ week, fallbackDate }: { week: MidweekWeek | null; fallbackDate: string }) {
  const date = dayHeading(week?.date ?? fallbackDate);
  const groups = groupParts(week?.parts ?? []);

  return (
    <section aria-labelledby="entre-semana">
      <MeetingHeading id="entre-semana" title="Reunión de entre semana" date={date} />

      {week?.asamblea && groups.length === 0 && <AssemblyCard name={week.asamblea} caption={date} />}

      {groups.length === 0 && !week?.asamblea && (
        <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />
      )}

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const color = SECTION_COLOR[group.section];
          return (
            <div key={group.section}>
              {group.section !== 'inicio' && (
                <h3 className="mb-1 flex items-center gap-2 text-secondary text-ink-soft">
                  {color && (
                    <span
                      aria-hidden
                      className="h-2 w-2 shrink-0"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {SECTION_LABEL[group.section]}
                </h3>
              )}
              <ul className="flex flex-col border-t border-line">
                {group.parts.map((part, i) => (
                  <li
                    key={`${part.time}-${part.title}-${i}`}
                    className="flex gap-3 border-b border-line py-3 last:border-b-0"
                  >
                    <time className="w-12 shrink-0 pt-0.5 font-mono text-body">
                      {part.time || '—'}
                    </time>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-strong break-words">{part.title}</p>
                      {part.people.length > 0 && (
                        <ul className="mt-1 flex flex-col">
                          {part.people.map((person, j) => (
                            <li
                              key={`${person.name}-${j}`}
                              className="flex flex-wrap items-baseline gap-x-2"
                            >
                              <span className="text-body text-ink">{person.name}</span>
                              {person.role && (
                                <span className="text-secondary text-ink-soft">{person.role}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeekendSection({
  meeting,
  fallbackDate,
}: {
  meeting: WeekendMeeting | null;
  fallbackDate: string;
}) {
  const date = dayHeading(meeting?.date ?? fallbackDate);
  const hasContent = meeting ? weekendHasContent(meeting) : false;

  const rows: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (meeting) {
    if (meeting.presidente) rows.push({ label: 'Presidente', value: meeting.presidente });
    if (meeting.cancionInicio) rows.push({ label: 'Canción inicial', value: meeting.cancionInicio, mono: true });
    if (meeting.conductor) rows.push({ label: 'Conductor', value: meeting.conductor });
    if (meeting.lector) rows.push({ label: 'Lector', value: meeting.lector });
    if (meeting.cancionFin) rows.push({ label: 'Canción final', value: meeting.cancionFin, mono: true });
    if (meeting.oracionFinal) rows.push({ label: 'Oración final', value: meeting.oracionFinal });
  }

  return (
    <section aria-labelledby="fin-de-semana">
      <MeetingHeading id="fin-de-semana" title="Reunión del fin de semana" date={date} />

      {meeting?.asamblea && !hasContent && (
        <AssemblyCard name={meeting.asamblea} caption={date} />
      )}

      {!hasContent && !meeting?.asamblea && (
        <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />
      )}

      {meeting?.discurso && (
        <div className="rounded-[10px] border border-line bg-surface px-4 py-3">
          <p className="text-secondary text-ink-soft">
            {meeting.discurso.tipo ? `Discurso ${meeting.discurso.tipo.toLowerCase()}` : 'Discurso'}
          </p>
          {meeting.discurso.titulo && (
            <p className="mt-0.5 text-body-strong break-words">{meeting.discurso.titulo}</p>
          )}
          {(meeting.discurso.orador || meeting.discurso.congregacion) && (
            <p className="mt-0.5 text-body break-words">
              {meeting.discurso.orador}
              {meeting.discurso.congregacion ? ` · Congregación ${meeting.discurso.congregacion}` : ''}
            </p>
          )}
          {meeting.discurso.saliente && (
            <p className="mt-1 text-secondary text-ink-soft break-words">
              Discursante saliente: {meeting.discurso.saliente}
            </p>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <dl className="mt-3 flex flex-col border-t border-line">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0"
            >
              <dt className="text-secondary text-ink-soft">{row.label}</dt>
              <dd
                className={`min-w-0 text-right break-words ${row.mono ? 'font-mono text-body' : 'text-body-strong'}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function EmptyState({ title, body, level = 3 }: { title: string; body: string; level?: 2 | 3 }) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-col gap-2 py-6">
      <Heading className="text-body-strong">{title}</Heading>
      <p className="max-w-prose text-body text-ink-soft">{body}</p>
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando el programa" className="flex flex-col gap-10">
      {[0, 1].map((block) => (
        <div key={block} className="flex flex-col gap-3">
          <div className="skeleton h-6 w-64" />
          <div className="skeleton h-5 w-44" />
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="skeleton h-14 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
