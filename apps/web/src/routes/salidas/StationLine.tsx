import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { RefreshCw } from 'lucide-react';
import type { GroupTerritories, ServiceMeetingRow } from '@territorios/data';
import { DAY_SLUGS, DAY_TOKEN, minutesOf, untilLabel } from '../../lib/week';
import { changedSinceSeen, markSeen } from '../../lib/seen';
import { dayColors } from '../../lib/salidaColors';

interface Props {
  dow: number;
  meetings: ServiceMeetingRow[];
  /** Set only when the line is today's, so past/next can be computed. */
  now: Date | null;
  /** Desktop split only: a station under the pointer or focus (null when it leaves). */
  onHover?: (meetingId: string | null) => void;
  /** Desktop split only: roundels show their territories in the map pane instead of opening Mapa. */
  onShow?: (ids: number[]) => void;
}

type StationState = 'past' | 'next' | 'later';

function stateOf(m: ServiceMeetingRow, nowMin: number | null, nextId: string | null): StationState {
  if (nowMin === null) return 'later';
  if (m.id === nextId) return 'next';
  const start = minutesOf(m.start_time);
  // A salida counts as gone 30 minutes after it starts: people may still be joining.
  return start !== null && start + 30 < nowMin ? 'past' : 'later';
}

/** The day drawn as a train line: each salida is a station, in time order. */
export function StationLine({ dow, meetings, now, onHover, onShow }: Props) {
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null;
  const colors = dayColors(meetings).byKey;
  const ordered = [...meetings].sort(
    (a, b) =>
      (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0) || a.position - b.position,
  );
  const next =
    nowMin === null
      ? null
      : (ordered.find((m) => (minutesOf(m.start_time) ?? -1) + 30 >= nowMin) ?? null);

  // Freeze change marks for this visit, then record what the member has now seen.
  const [changed] = useState(
    () => new Set(meetings.filter((m) => changedSinceSeen(m.id, m.version)).map((m) => m.id)),
  );
  useEffect(() => {
    markSeen(meetings.map(({ id, version }) => ({ id, version })));
  }, [meetings]);

  return (
    <ol
      className="station-line"
      style={{ '--day': `var(--tk-day-${DAY_TOKEN[dow]}-accent)` } as React.CSSProperties}
    >
      {ordered.map((m) => {
        const state = stateOf(m, nowMin, next?.id ?? null);
        const start = minutesOf(m.start_time);
        return (
          <li
            key={m.id}
            className="station"
            data-state={state}
            onMouseEnter={onHover && (() => onHover(m.id))}
            onMouseLeave={onHover && (() => onHover(null))}
            onFocus={onHover && (() => onHover(m.id))}
            onBlur={onHover && (() => onHover(null))}
          >
            <span aria-hidden className="station-dot" />
            <article className="station-card" aria-current={state === 'next' ? 'time' : undefined}>
              {state === 'next' && nowMin !== null && start !== null && (
                <p className="text-secondary font-bold text-day-ink">
                  {start > nowMin ? `Próxima · ${untilLabel(start - nowMin)}` : 'Empezando ahora'}
                </p>
              )}
              {changed.has(m.id) && (
                <p className="change-mark">
                  <RefreshCw aria-hidden size={16} />
                  Cambió desde tu última visita
                </p>
              )}
              <p className="station-time">
                <time>{m.start_time || 'Sin hora'}</time>
                {state === 'past' && <span className="sr-only"> (ya salió)</span>}
              </p>
              <h3 className="text-body font-semibold">{m.place || 'Lugar a confirmar'}</h3>
              {(m.conductor || m.groups) && (
                <p className="text-secondary text-ink-soft">
                  {m.conductor && <>Conduce {m.conductor}</>}
                  {m.conductor && m.groups && <br />}
                  {m.groups && <>{groupsLabel(m.groups)}</>}
                </p>
              )}
              {m.kind === 'domingo' && (
                <GroupRows
                  dow={dow}
                  groups={m.group_territories}
                  onShow={onShow}
                  colorOf={(g) => colors.get(`${m.id}:${g}`)}
                />
              )}
              {m.territory_ids.length > 0 && (
                <Roundels
                  dow={dow}
                  ids={m.territory_ids}
                  onShow={onShow}
                  color={colors.get(m.id)}
                />
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}

/** "2" → "Grupo 2"; "1 y 2" / "1, 2" → "Grupos 1 y 2"; free text ("Todos") stays as written. */
export function groupsLabel(groups: string): string {
  if (!/^\d/.test(groups)) return groups;
  return /^\d+$/.test(groups.trim()) ? `Grupo ${groups.trim()}` : `Grupos ${groups}`;
}

type ShowFn = Props['onShow'];

function Roundels({
  dow,
  ids,
  label,
  onShow,
  color,
}: {
  dow: number;
  ids: number[];
  label?: string;
  onShow: ShowFn;
  /** The salida's colour, the same one its territories wear on the map. */
  color?: string | undefined;
}) {
  return (
    <Link
      to={`/mapa?t=${ids.join(',')}&dia=${DAY_SLUGS[dow]}`}
      className="roundel-row"
      aria-label={`${label ? `${label}: ` : ''}territorios ${ids.join(', ')}. Ver en el mapa`}
      onClick={
        onShow &&
        ((e) => {
          // A plain click shows them in the pane beside; modified clicks still open the full Mapa.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onShow(ids);
        })
      }
    >
      {ids.map((id) => (
        <span
          key={id}
          className="roundel"
          style={color ? { background: color, color: '#fff' } : undefined}
        >
          {id}
        </span>
      ))}
      <span className="roundel-hint">Ver en el mapa</span>
    </Link>
  );
}

function GroupRows({
  dow,
  groups,
  onShow,
  colorOf,
}: {
  dow: number;
  groups: GroupTerritories;
  onShow: ShowFn;
  colorOf: (group: string) => string | undefined;
}) {
  const keys = (['G1', 'G2', 'G3', 'G4'] as const).filter((g) => (groups[g]?.length ?? 0) > 0);
  if (!keys.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
      {keys.map((g) => (
        <div key={g} className="contents">
          <dt className="font-mono text-secondary font-bold">{g}</dt>
          <dd>
            <Roundels
              dow={dow}
              ids={groups[g]!}
              label={`Grupo ${g.slice(1)}`}
              onShow={onShow}
              color={colorOf(g)}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}
