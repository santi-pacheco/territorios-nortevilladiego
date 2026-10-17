import { useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { onlineManager, useQueries } from '@tanstack/react-query';
import { programWeekQuery, useCartSchedule, useSession } from '@territorios/data';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { GoogleButton } from '../../shell/GoogleButton';
import { useMyAssignments, useMyLink, type MyAssignment } from '../../lib/accounts';
import { mondayOf, fromIso } from '../../lib/week';
import { SECTION_COLOR, sanitizeMidweek } from '../programa/model';
import { KindMarker, type MarkerColors } from './Markers';
import { Reminders } from './Reminders';
import {
  KIND_LABEL,
  dayOfMonth,
  dayToken,
  detailLine,
  groupByWeek,
  hhmm,
  longDay,
  nextAssignment,
  placeLine,
  relativeDay,
  shortWeekday,
  sortAssignments,
} from './model';
import './mis-asignaciones.css';

const CONGREGATION = 'Cong. Norte Villa Diego';

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

export function Component() {
  const session = useSession();
  const signedIn = Boolean(session.data);
  const link = useMyLink();
  const linkedName = link.data?.person_name ?? null;

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface pb-3">
        <ScreenHeader
          caption={linkedName ? `${CONGREGATION} · ${linkedName}` : CONGREGATION}
          title="Mis asignaciones"
        />
      </header>

      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {session.isPending || (signedIn && link.isPending) ? (
          <ListSkeleton />
        ) : !signedIn ? (
          <SignedOut />
        ) : link.isError && !link.data ? (
          <LoadError onRetry={() => void link.refetch()} />
        ) : !link.data ? (
          <NotLinked
            name={(session.data?.user.user_metadata?.full_name as string | undefined) ?? null}
            email={session.data?.user.email ?? null}
          />
        ) : (
          <Linked />
        )}
      </div>
    </main>
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
    <Message title="Tus turnos, partes y salidas, en un solo lugar">
      <p className="text-body text-ink-soft">
        Entrá con tu cuenta de Google y vas a ver acá tus turnos de carrito, tus partes de la
        reunión y las salidas que conducís, con recordatorios 7 días y 1 día antes.
      </p>
      <p className="text-body text-ink-soft">
        La primera vez, un encargado vincula tu cuenta con tu nombre.
      </p>
      <GoogleButton className="mt-2 sm:max-w-xs" />
    </Message>
  );
}

function NotLinked({ name, email }: { name: string | null; email: string | null }) {
  return (
    <Message title="Tu cuenta todavía no está vinculada">
      <p className="text-body text-ink-soft">
        Pedile a un encargado que vincule tu cuenta con tu nombre. Cuando lo haga, tus
        asignaciones aparecen acá solas.
      </p>
      <dl className="asig-account">
        {name && (
          <div>
            <dt className="text-secondary text-ink-soft">Nombre en Google</dt>
            <dd className="text-body-strong font-semibold break-words">{name}</dd>
          </div>
        )}
        {email && (
          <div>
            <dt className="text-secondary text-ink-soft">Correo para el encargado</dt>
            <dd className="text-body-strong font-semibold break-words">{email}</dd>
          </div>
        )}
      </dl>
    </Message>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const online = useOnline();
  return online ? (
    <Message title="No pudimos cargar tus asignaciones">
      <p className="text-body text-ink-soft">Puede ser la conexión. Probá de nuevo en un momento.</p>
      <button type="button" className="btn-secondary self-start" onClick={onRetry}>
        Reintentar
      </button>
    </Message>
  ) : (
    <Message title="Sin conexión">
      <p className="text-body text-ink-soft">
        Tus asignaciones se cargan cuando vuelva la conexión. Las salidas, el carrito y el
        programa siguen disponibles con lo último que se cargó.
      </p>
    </Message>
  );
}

function Linked() {
  const query = useMyAssignments();
  const now = useMemo(() => new Date(), []);
  const sorted = useMemo(() => sortAssignments(query.data ?? []), [query.data]);
  const next = nextAssignment(sorted, now);
  const rest = sorted.filter((a) => a !== next);
  const weeks = groupByWeek(rest, now);
  const colors = useMarkerColors(sorted);

  if (query.isPending) return <ListSkeleton />;
  if (query.isError && !query.data) return <LoadError onRetry={() => void query.refetch()} />;

  return (
    <div className="asig-layout">
      {next ? (
        <NextCard a={next} now={now} colors={colors} />
      ) : sorted.length > 0 ? null : (
        <Message title="No tenés asignaciones en los próximos 90 días">
          <p className="text-body text-ink-soft">
            Cuando te asignen un turno de carrito, una parte de la reunión o una salida, aparece
            acá al instante.
          </p>
        </Message>
      )}

      <Reminders />

      {weeks.length > 0 && (
        <div className="asig-weeks">
          {weeks.map((w) => (
            <section key={w.monday} aria-labelledby={`asig-${w.monday}`}>
              <h2 id={`asig-${w.monday}`} className="mb-1 text-heading font-bold">
                {w.heading}
              </h2>
              <ul className="flex flex-col border-t border-line">
                {w.items.map((a, i) => (
                  <Row key={a.key} a={a} showDate={i === 0 || w.items[i - 1]!.date !== a.date} colors={colors} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function KindLine({ a, colors }: { a: MyAssignment; colors: MarkerColors }) {
  return (
    <p className="flex items-center gap-2 text-secondary text-ink-soft">
      <KindMarker a={a} colors={colors} />
      <span>
        {KIND_LABEL[a.kind]}
        {a.role && <> · {a.role}</>}
      </span>
    </p>
  );
}

function Details({ a }: { a: MyAssignment }) {
  const place = placeLine(a);
  const detail = detailLine(a);
  return (
    <>
      {place && <p className="text-secondary break-words">{place}</p>}
      {detail && <p className="text-secondary break-words text-ink-soft">{detail}</p>}
    </>
  );
}

function NextCard({ a, now, colors }: { a: MyAssignment; now: Date; colors: MarkerColors }) {
  const time = hhmm(a.start_time);
  return (
    <section
      aria-labelledby="asig-next"
      className="asig-next"
      style={
        a.kind === 'salida'
          ? ({ '--day': `var(--tk-day-${dayToken(a.date)}-accent)` } as CSSProperties)
          : undefined
      }
    >
      <p className="text-secondary font-bold asig-next-tag">Próxima · {relativeDay(a.date, now)}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-body-strong font-semibold">
          <time dateTime={a.date}>{longDay(a.date)}</time>
        </p>
        {time && <time className="station-time">{time}</time>}
      </div>
      <h2 id="asig-next" className="mt-2 text-heading font-bold break-words">
        {a.title}
      </h2>
      <div className="mt-1 flex flex-col gap-0.5">
        <KindLine a={a} colors={colors} />
        <Details a={a} />
      </div>
    </section>
  );
}

function Row({ a, showDate, colors }: { a: MyAssignment; showDate: boolean; colors: MarkerColors }) {
  const time = hhmm(a.start_time);
  return (
    <li className="asig-row">
      <div className="asig-date" aria-hidden={!showDate}>
        {showDate && (
          <time dateTime={a.date}>
            <span className="block text-secondary text-ink-soft">{shortWeekday(a.date)}</span>
            <span className="block font-mono text-title font-bold">{dayOfMonth(a.date)}</span>
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <KindLine a={a} colors={colors} />
          {time && <time className="font-mono text-body font-semibold whitespace-nowrap">{time}</time>}
        </div>
        <p className="text-body-strong font-semibold break-words">
          {!showDate && <span className="sr-only">{longDay(a.date)}: </span>}
          {a.title}
        </p>
        <Details a={a} />
      </div>
    </li>
  );
}

/** Place colours from the carrito board; section colours from that week's programme. */
function useMarkerColors(list: MyAssignment[]): MarkerColors {
  const hasCart = list.some((a) => a.kind === 'carrito');
  const board = useCartSchedule();
  const programa = list.filter((a) => a.kind === 'programa');
  const mondays = [...new Set(programa.map((a) => mondayOf(fromIso(a.date))))];
  const weeks = useQueries({ queries: mondays.map((m) => programWeekQuery(m)) });

  const place = new Map<string, string>();
  if (hasCart) for (const p of board.data?.places ?? []) place.set(p.name, p.color);
  const section = new Map<string, string>();
  const norm = (s: string) => s.trim().toLowerCase();
  mondays.forEach((monday, i) => {
    const row = weeks[i]?.data?.midweek;
    const midweek = row ? sanitizeMidweek(row.data, row.date) : null;
    if (!midweek) return;
    for (const a of programa) {
      if (mondayOf(fromIso(a.date)) !== monday) continue;
      const part = midweek.parts.find((p) => norm(p.title) === norm(a.title));
      const color = part && SECTION_COLOR[part.section];
      if (color) section.set(a.key, color);
    }
  });
  return { place, section };
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando tus asignaciones" className="flex flex-col gap-6">
      <div className="skeleton h-36 w-full rounded-[10px]" />
      <div className="flex flex-col gap-3">
        <div className="skeleton h-6 w-40" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="skeleton h-12 w-12" />
            <div className="skeleton h-16 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
