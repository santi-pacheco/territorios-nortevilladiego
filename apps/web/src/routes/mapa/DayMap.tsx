/**
 * The map pane of the desktop Salidas + Mapa split. It borrows the app's one MapLibre instance
 * (engine.ts) while Salidas is mounted, and is only ever loaded through a dynamic import, so
 * phones never download maplibre for Salidas.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useTerritories, type ServiceMeetingRow } from '@territorios/data';
import { DAY_NAME, DAY_SLUGS, DAY_TOKEN } from '../../lib/week';
import { dayColors } from '../../lib/salidaColors';
import * as engine from './engine';
import { territoriesOfMeeting } from './model';
import { subscribeTheme, themeSnapshot } from './theme';
import './mapa.css';

export interface DayMapProps {
  dow: number;
  meetings: ServiceMeetingRow[];
  /** Identifies the shown day (week + day), so the camera reframes when it changes. */
  dayKey: string;
  /** The station under the pointer or keyboard focus. */
  hoverId: string | null;
  /** Territories whose roundels were clicked last; `n` makes a repeat click refit. */
  pick: { ids: number[]; n: number } | null;
}

export default function DayMap({ dow, meetings, dayKey, hoverId, pick }: DayMapProps) {
  const navigate = useNavigate();
  const territories = useTerritories();
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot);
  const hostRef = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(true);
  const initialTheme = useRef(theme);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // No overlay header here; the Mapa route measures its own on mount.
    engine.setTopInset(0);
    if (!engine.attach(host, initialTheme.current)) {
      queueMicrotask(() => setWebgl(false));
      return;
    }
    return () => engine.detach(host);
  }, []);

  useEffect(() => engine.setTheme(theme), [theme]);

  useEffect(() => {
    if (territories.data) engine.setTerritories(territories.data);
  }, [territories.data]);

  const colors = useMemo(() => dayColors(meetings).byTerritory, [meetings]);
  const hovered = meetings.find((m) => m.id === hoverId);
  const selectedKey = (hovered ? territoriesOfMeeting(hovered) : (pick?.ids ?? [])).join(',');

  useEffect(() => {
    const selected = new Set(selectedKey ? selectedKey.split(',').map(Number) : []);
    engine.setHighlight(DAY_TOKEN[dow] ?? null, colors, selected);
  }, [dow, colors, selectedKey]);

  // Frame the day's territories; a roundel click frames its own and stays until the day changes.
  const loaded = territories.data !== undefined;
  useEffect(() => {
    if (!loaded) return;
    if (pick) engine.focus(pick.ids, `salidas:${dayKey}:pick:${pick.n}`);
    else engine.focus([...colors.keys()], `salidas:${dayKey}`);
  }, [loaded, dayKey, pick, colors]);

  // A tap on a polygon opens the full Mapa on it: directions and the sheet live there.
  useEffect(() => {
    engine.handlers.onTerritoryTap = (id) => navigate(`/mapa?t=${id}&dia=${DAY_SLUGS[dow]}`);
    engine.handlers.onUserGesture = () => {};
  });

  const loadFailed = territories.isError && !territories.data;

  return (
    <>
      <div
        ref={hostRef}
        className="mapa-host"
        role="region"
        aria-label={`Mapa de los territorios del ${DAY_NAME[dow]?.toLowerCase() ?? 'día'}`}
      />
      {(!webgl || loadFailed) && (
        <div className="mapa-notice" role="status">
          {!webgl ? (
            <p>Este navegador no puede mostrar el mapa. Las salidas siguen a la izquierda.</p>
          ) : (
            <>
              <p>No pudimos cargar los territorios. Revisá la conexión.</p>
              <button type="button" className="btn-secondary" onClick={() => territories.refetch()}>
                Reintentar
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
