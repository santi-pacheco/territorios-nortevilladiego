import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { Compass, LocateFixed, LocateOff, Navigation } from 'lucide-react';
import { useServiceWeek, useTerritories, type ServiceMeetingRow } from '@territorios/data';
import { AccountButton } from '../../shell/AccountSheet';
import {
  DAY_NAME,
  DAY_SLUGS,
  DAY_TOKEN,
  WEEK_ORDER,
  dateOfDow,
  mondayOf,
  slugToDow,
} from '../../lib/week';
import { DayStrip } from '../salidas/DayStrip';
import { dayColors } from '../../lib/salidaColors';
import * as engine from './engine';
import { Locator } from './locate';
import { parseTerritoryParam, type LocateMode } from './model';
import { subscribeTheme, themeSnapshot } from './theme';
import './mapa.css';

const LOCATE_LABEL: Record<LocateMode, string> = {
  off: 'Ubicarme',
  follow: 'Siguiéndote',
  compass: 'Brújula',
};
const LOCATE_ICON = { off: LocateFixed, follow: Navigation, compass: Compass } as const;

export function Component() {
  const [params, setParams] = useSearchParams();
  const [now] = useState(() => new Date());
  const monday = mondayOf(now);
  const week = useServiceWeek(monday);
  const territories = useTerritories();
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);

  const byDow = useMemo(() => {
    const map = new Map<number, ServiceMeetingRow[]>();
    for (const m of week.data?.meetings ?? []) {
      const list = map.get(m.dow) ?? [];
      list.push(m);
      map.set(m.dow, list);
    }
    return map;
  }, [week.data]);

  // Same day choice as Salidas: the route's day, else today, else the next day with salidas.
  const days = WEEK_ORDER.filter((d) => byDow.has(d));
  const todayDow = now.getDay();
  const fromRoute = slugToDow(params.get('dia') ?? undefined);
  const day =
    fromRoute !== null && byDow.has(fromRoute)
      ? fromRoute
      : byDow.has(todayDow)
        ? todayDow
        : (days.find((d) => (d + 6) % 7 > (todayDow + 6) % 7) ?? days[0] ?? null);
  const dayMeetings = useMemo(() => (day === null ? [] : (byDow.get(day) ?? [])), [byDow, day]);
  const dayLabel = day === null ? null : `${DAY_NAME[day]} ${dateOfDow(monday, day).getDate()}`;

  // `?t=` focuses territories; a tap replaces that selection until the link changes.
  const tParam = params.get('t');
  const focusIds = useMemo(() => parseTerritoryParam(tParam), [tParam]);
  const [tap, setTap] = useState<{ id: number; from: string | null } | null>(null);
  const tapped = tap && tap.from === tParam ? tap.id : null;
  const selectedKey = tapped !== null ? String(tapped) : focusIds.join(',');

  // ---- map lifecycle -------------------------------------------------------
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(true);
  const initialTheme = useRef(theme);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!engine.attach(host, initialTheme.current)) {
      // The map is not optional decoration: tell the member why it is missing.
      queueMicrotask(() => setWebgl(false));
      return;
    }
    return () => engine.detach(host);
  }, []);

  useEffect(() => engine.setTheme(theme), [theme]);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    engine.setTopInset(el.offsetHeight);
    const ro = new ResizeObserver(() => engine.setTopInset(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (territories.data) engine.setTerritories(territories.data);
  }, [territories.data]);

  useEffect(() => {
    const selected = new Set(selectedKey ? selectedKey.split(',').map(Number) : []);
    engine.setHighlight(
      day === null ? null : (DAY_TOKEN[day] ?? null),
      dayColors(dayMeetings).byTerritory,
      selected,
    );
  }, [day, dayMeetings, selectedKey]);

  useEffect(() => {
    if (territories.data) engine.focus(focusIds, tParam ?? 'all');
  }, [territories.data, focusIds, tParam]);

  // ---- locate ----------------------------------------------------------------
  const [locate, setLocate] = useState<{ mode: LocateMode; message: string | null }>({
    mode: 'off',
    message: null,
  });
  const [locator] = useState(() => new Locator((mode, message) => setLocate({ mode, message })));
  useEffect(() => () => locator.dispose(), [locator]);

  useEffect(() => {
    engine.handlers.onTerritoryTap = (id) => {
      // A tap highlights that territory; tapping it again clears the highlight.
      setTap((prev) => (prev && prev.id === id && prev.from === tParam ? null : { id, from: tParam }));
    };
    engine.handlers.onUserGesture = () => {
      if (locator.mode !== 'off') locator.set('off');
    };
  });

  function selectDay(dow: number) {
    setParams(
      (p) => {
        p.set('dia', DAY_SLUGS[dow] ?? '');
        return p;
      },
      { replace: true },
    );
  }

  const LocateIcon = locate.mode === 'off' && locate.message ? LocateOff : LOCATE_ICON[locate.mode];
  const loadFailed = territories.isError && !territories.data;

  return (
    <main className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={hostRef} className="mapa-host" aria-label="Mapa de territorios" role="region" />

      <header
        ref={overlayRef}
        className="absolute inset-x-0 top-0 z-10 border-b border-line bg-surface"
      >
        <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <p className="text-secondary text-ink-soft">
              {territories.data
                ? `${territories.data.length} territorios · ${day === null ? 'sin salidas esta semana' : 'esta semana'}`
                : 'Mapa de territorios'}
            </p>
            <h1 className="mt-1 text-display font-bold">{dayLabel ?? 'Mapa'}</h1>
          </div>
          <div className="lg:hidden">
            <AccountButton />
          </div>
        </div>
        {week.isPending ? (
          <div aria-hidden className="mx-auto flex w-full max-w-3xl gap-1 px-2 pt-2 pb-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-12 flex-1" />
            ))}
          </div>
        ) : days.length > 0 ? (
          <DayStrip
            days={days}
            counts={byDow}
            selected={day}
            todayDow={todayDow}
            onSelect={selectDay}
          />
        ) : (
          <div className="pb-2" />
        )}
      </header>

      {(!webgl || loadFailed || (territories.data && territories.data.length === 0)) && (
        <div className="mapa-notice" role="status">
          {!webgl ? (
            <p>
              Este dispositivo no puede mostrar el mapa. Probá con otro navegador o actualizá el
              sistema.
            </p>
          ) : loadFailed ? (
            <>
              <p>No pudimos cargar los territorios. Revisá la conexión.</p>
              <button type="button" className="btn-secondary" onClick={() => territories.refetch()}>
                Reintentar
              </button>
            </>
          ) : (
            <p>
              Todavía no hay territorios cargados. Cuando los encargados los importen, aparecen acá.
            </p>
          )}
        </div>
      )}

      {webgl && (
        <div className="mapa-controls">
          {locate.message && (
            <p role="status" className="mapa-toast">
              {locate.message}
            </p>
          )}
          <button
            type="button"
            className="locate-btn"
            aria-pressed={locate.mode !== 'off'}
            data-mode={locate.mode}
            onClick={() => locator.cycle()}
          >
            <LocateIcon aria-hidden size={22} strokeWidth={2} />
            <span>{LOCATE_LABEL[locate.mode]}</span>
          </button>
        </div>
      )}

    </main>
  );
}
