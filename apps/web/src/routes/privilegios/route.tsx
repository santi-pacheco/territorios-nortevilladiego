/**
 * /privilegios: who runs computadora, sonido, micrófonos and acomodadores at each meeting
 * (Tuesday and Saturday) of a month. Visible to editors, to can_edit_privilegios and to members
 * whose linked person has a duty (`my_permissions().sees_privilegios`).
 */
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { onlineManager } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, PencilLine } from 'lucide-react';
import { useDutyRoster, useMyPermissions, useSession, type DutyRole } from '@territorios/data';
import { AccountButton } from '../../shell/AccountSheet';
import { GoogleButton } from '../../shell/GoogleButton';
import { matchesMe, useMeName } from '../../lib/me';
import { toIso } from '../../lib/week';
import {
  bannerText,
  buildRosterDays,
  dayNumber,
  longDay,
  mesParam,
  monthBounds,
  monthLabel,
  namesFor,
  nextDate,
  parseMesParam,
  shiftMonth,
  weekdayShort,
  type Month,
  type RosterDay,
} from './model';
import './privilegios.css';

const CONGREGATION = 'Cong. Norte Villa Diego';

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

export function Component() {
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const thisMonth: Month = { year: today.getFullYear(), month: today.getMonth() };
  const month = parseMesParam(params.get('mes'), thisMonth);
  const session = useSession();
  const signedIn = Boolean(session.data);
  const perms = useMyPermissions();

  function go(delta: number) {
    const next = shiftMonth(month, delta);
    const same = next.year === thisMonth.year && next.month === thisMonth.month;
    setParams(same ? {} : { mes: mesParam(next) }, { replace: true });
  }

  const allowed = perms.data?.sees_privilegios === true;

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface pb-2">
        <MonthHeader
          caption={`${CONGREGATION} · ${monthLabel(month)}`}
          onPrev={allowed ? () => go(-1) : undefined}
          onNext={allowed ? () => go(1) : undefined}
        />
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {session.isPending || (signedIn && perms.isPending) ? (
          <TableSkeleton />
        ) : !signedIn ? (
          <SignedOut />
        ) : perms.isError && !perms.data ? (
          <LoadError onRetry={() => void perms.refetch()} />
        ) : !allowed ? (
          <NotAllowed />
        ) : (
          <Roster month={month} canEdit={perms.data?.can_edit_privilegios === true} />
        )}
      </div>
    </main>
  );
}

/** Same structure as ScreenHeader, with the arrows moving a month. */
function MonthHeader({
  caption,
  onPrev,
  onNext,
}: {
  caption: string;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 pt-2 text-secondary text-ink-soft">
          {caption}
        </p>
        <div className="lg:hidden">
          <AccountButton />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-1">
        <h1 className="mr-auto text-display font-bold">Privilegios</h1>
        {onPrev && onNext && (
          <div className="flex items-center">
            <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={onPrev}>
              <ChevronLeft aria-hidden size={24} />
            </button>
            <span aria-hidden className="text-secondary font-semibold text-ink-soft">
              Mes
            </span>
            <button
              type="button"
              className="icon-btn -mr-3"
              aria-label="Mes siguiente"
              onClick={onNext}
            >
              <ChevronRight aria-hidden size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-prose flex-col gap-3 py-6">
      <h2 className="text-heading font-bold">{title}</h2>
      {children}
    </div>
  );
}

function SignedOut() {
  return (
    <Message title="Computadora, sonido, micrófonos y acomodadores">
      <p className="text-body text-ink-soft">
        Esta lista la ven los encargados y los hermanos que tienen alguno de estos privilegios.
        Entrá con tu cuenta de Google para verla.
      </p>
      <GoogleButton className="mt-2 sm:max-w-xs" />
    </Message>
  );
}

function NotAllowed() {
  return (
    <Message title="Esta lista es para quienes tienen estos privilegios">
      <p className="text-body text-ink-soft">
        La ven los encargados y los hermanos anotados para computadora, sonido, micrófonos o
        acomodadores.
      </p>
      <p className="text-body text-ink-soft">
        Si te corresponde, pedile a un encargado que vincule tu cuenta con tu nombre y marque tus
        privilegios.
      </p>
    </Message>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const online = useOnline();
  return online ? (
    <Message title="No pudimos cargar los privilegios">
      <p className="text-body text-ink-soft">Puede ser la conexión. Probá de nuevo en un momento.</p>
      <button type="button" className="btn-secondary self-start" onClick={onRetry}>
        Reintentar
      </button>
    </Message>
  ) : (
    <Message title="Sin conexión">
      <p className="text-body text-ink-soft">
        Los privilegios se cargan cuando vuelva la conexión.
      </p>
    </Message>
  );
}

const COLUMNS: { role: DutyRole; label: string }[] = [
  { role: 'computadora', label: 'Computadora' },
  { role: 'sonido', label: 'Sonido' },
  { role: 'microfonista', label: 'Micrófonos' },
  { role: 'acomodador', label: 'Acomodadores' },
];

function Roster({ month, canEdit }: { month: Month; canEdit: boolean }) {
  const { from, to } = monthBounds(month);
  const roster = useDutyRoster(from, to);
  const me = useMeName();
  const todayIso = toIso(new Date());

  const days = useMemo(
    () => buildRosterDays(month, roster.data?.rows ?? [], roster.data?.days ?? []),
    [month, roster.data],
  );

  if (roster.isPending) return <TableSkeleton />;
  if (roster.isError && !roster.data) return <LoadError onRetry={() => void roster.refetch()} />;

  const hasRows = (roster.data?.rows.length ?? 0) > 0;
  const hasMarks = (roster.data?.days.length ?? 0) > 0;
  const columns = COLUMNS.filter(
    (c) => c.role !== 'acomodador' || roster.data?.rows.some((r) => r.role === 'acomodador'),
  );
  const next = nextDate(days, todayIso);

  return (
    <div className="flex flex-col gap-5">
      {canEdit && (
        <Link
          to="/gestion/privilegios"
          className="btn-secondary inline-flex items-center justify-center gap-2 self-start"
        >
          <PencilLine aria-hidden size={20} />
          Editar privilegios
        </Link>
      )}

      {!hasRows && !hasMarks ? (
        <Message title={`Todavía no se cargaron los privilegios de ${monthLabel(month).split(' ')[0]}`}>
          <p className="text-body text-ink-soft">
            Cuando un encargado los cargue, aparecen acá enseguida.
          </p>
        </Message>
      ) : (
        <>
          <RosterTable days={days} columns={columns} me={me} today={todayIso} next={next} />
          <RosterCards days={days} columns={columns} me={me} today={todayIso} next={next} />
        </>
      )}
    </div>
  );
}

interface ViewProps {
  days: RosterDay[];
  columns: { role: DutyRole; label: string }[];
  me: string;
  today: string;
  next: string | null;
}

function Names({ day, role, me }: { day: RosterDay; role: DutyRole; me: string }) {
  const rows = namesFor(day, role);
  if (rows.length === 0) {
    return (
      <>
        <span aria-hidden className="text-ink-disabled">
          —
        </span>
        <span className="sr-only">Sin asignar</span>
      </>
    );
  }
  return (
    <ul className="flex flex-col">
      {rows.map((r) => {
        const name = r.person_name ?? '';
        const mine = matchesMe(me, name);
        return (
          <li key={r.id} className="break-words">
            {mine ? (
              <strong className="font-bold">
                {name}
                <span className="sr-only"> (vos)</span>
              </strong>
            ) : (
              name
            )}
          </li>
        );
      })}
    </ul>
  );
}

function rowState(date: string, today: string, next: string | null): string {
  if (date === next) return 'is-next';
  return date < today ? 'is-past' : '';
}

function RosterTable({ days, columns, me, today, next }: ViewProps) {
  return (
    <table className="priv-table">
      <thead>
        <tr>
          <th scope="col">Fecha</th>
          {columns.map((c) => (
            <th key={c.role} scope="col">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((day) => (
          <tr key={day.date} className={rowState(day.date, today, next)}>
            <th scope="row" className="priv-date">
              <time dateTime={day.date}>
                <span className="sr-only">{longDay(day.date)}</span>
                <span aria-hidden className="text-secondary text-ink-soft">
                  {weekdayShort(day.date)}
                </span>{' '}
                <span aria-hidden className="font-mono text-heading font-bold">
                  {dayNumber(day.date)}
                </span>
              </time>
              {day.date === next && <span className="priv-next-tag">Próxima</span>}
            </th>
            {day.kind === 'normal' ? (
              columns.map((c) => (
                <td key={c.role}>
                  <Names day={day} role={c.role} me={me} />
                </td>
              ))
            ) : (
              <td colSpan={columns.length} className="priv-banner">
                {bannerText(day)}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RosterCards({ days, columns, me, today, next }: ViewProps) {
  return (
    <ol className="priv-cards">
      {days.map((day) => (
        <li key={day.date} className={`priv-card ${rowState(day.date, today, next)}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-body-strong font-bold">
              <time dateTime={day.date}>{longDay(day.date)}</time>
            </h2>
            {day.date === next && <span className="priv-next-tag">Próxima</span>}
          </div>
          {day.kind === 'normal' ? (
            <dl className="priv-card-roles">
              {columns.map((c) => (
                <div key={c.role}>
                  <dt className="text-secondary text-ink-soft">{c.label}</dt>
                  <dd>
                    <Names day={day} role={c.role} me={me} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="priv-banner">{bannerText(day)}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando los privilegios" className="flex flex-col gap-3">
      <div className="skeleton h-8 w-full" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skeleton h-16 w-full" />
      ))}
    </div>
  );
}
