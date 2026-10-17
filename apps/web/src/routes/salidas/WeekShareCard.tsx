import { useLayoutEffect, useRef } from 'react';
import type { ServiceMeetingRow } from '@territorios/data';
import { colorForDow } from '@territorios/core';
import { DAY_NAME, WEEK_ORDER, addDaysIso, dateOfDow, fromIso, minutesOf } from '../../lib/week';

/** Export width in CSS px; the snapshot runs at pixelRatio 2, so WhatsApp gets a crisp image. */
const WIDTH = 1080;
const GROUPS = ['G1', 'G2', 'G3', 'G4'] as const;
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
/** HORA · LUGAR · CONDUCTOR · GRUPOS · TERRITORIO. */
const COLUMNS = '160px minmax(0,1.75fr) minmax(0,1.65fr) minmax(0,0.75fr) minmax(0,1.25fr)';

/** "12 al 18 de octubre", or "28 de septiembre al 4 de octubre" across months. */
export function weekLabel(monday: string): string {
  const a = fromIso(monday);
  const b = fromIso(addDaysIso(monday, 6));
  const from = `${a.getDate()} de ${MONTHS[a.getMonth()]}`;
  const to = `${b.getDate()} de ${MONTHS[b.getMonth()]}`;
  return a.getMonth() === b.getMonth() ? `${a.getDate()} al ${to}` : `${from} al ${to}`;
}

function byTime(a: ServiceMeetingRow, b: ServiceMeetingRow): number {
  return (minutesOf(a.start_time) ?? 0) - (minutesOf(b.start_time) ?? 0) || a.position - b.position;
}

/**
 * The full week as one printable card, hidden off-screen and captured by `shareNodeAsPng`.
 * Loaded lazily (see `ShareWeekButton`), so it stays out of the startup bundle. Kept in the
 * printed-form palette (`colorForDow`) rather than the theme, because it is an image people
 * forward on WhatsApp, not app chrome.
 */
export function WeekShareCard({
  monday,
  meetings,
  onReady,
}: {
  monday: string;
  meetings: ServiceMeetingRow[];
  onReady: (node: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) onReady(ref.current);
  }, [onReady]);

  const byDow = new Map<number, ServiceMeetingRow[]>();
  for (const m of meetings) {
    const list = byDow.get(m.dow) ?? [];
    list.push(m);
    byDow.set(m.dow, list);
  }
  const days = WEEK_ORDER.filter((d) => byDow.has(d));

  return (
    <div
      aria-hidden
      style={{ position: 'fixed', left: -100_000, top: 0, pointerEvents: 'none' }}
    >
      <div
        ref={ref}
        style={{
          width: WIDTH,
          background: '#FFFFFF',
          color: '#14181F',
          fontFamily: 'var(--tk-font-ui)',
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <header>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.2, fontWeight: 700 }}>
            Salidas · Cong. Norte Villa Diego
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 24, color: '#4A5363' }}>
            Semana del {weekLabel(monday)}
          </p>
        </header>
        {days.map((dow) => (
          <DayBlock key={dow} dow={dow} date={dateOfDow(monday, dow)} meetings={byDow.get(dow)!} />
        ))}
      </div>
    </div>
  );
}

function DayBlock({ dow, date, meetings }: { dow: number; date: Date; meetings: ServiceMeetingRow[] }) {
  const color = colorForDow(dow);
  const rows = [...meetings].sort(byTime);
  return (
    <section style={{ border: '2px solid #14181F' }}>
      <div
        style={{
          background: color.header,
          color: color.ink,
          padding: '10px 18px',
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        {DAY_NAME[dow]} {date.getDate()} de {MONTHS[date.getMonth()]}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          gap: 0,
          background: color.band,
          color: color.ink,
          fontSize: 17,
          fontWeight: 700,
          padding: '6px 18px',
        }}
      >
        <span>Hora</span>
        <span>Lugar</span>
        <span>Conductor</span>
        <span>Grupos</span>
        <span>Territorio</span>
      </div>
      {rows.map((m, i) => (
        <MeetingRow key={m.id} meeting={m} last={i === rows.length - 1} />
      ))}
    </section>
  );
}

function MeetingRow({ meeting, last }: { meeting: ServiceMeetingRow; last: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLUMNS,
        alignItems: 'start',
        gap: '0 12px',
        padding: '12px 18px',
        fontSize: 22,
        lineHeight: 1.35,
        borderBottom: last ? 'none' : '1px solid #14181F',
      }}
    >
      <span style={{ fontFamily: 'var(--tk-font-numeric)', fontWeight: 700 }}>
        {meeting.start_time || '—'}
      </span>
      <span style={{ overflowWrap: 'anywhere' }}>{meeting.place || 'A confirmar'}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{meeting.conductor || '—'}</span>
      <span style={{ overflowWrap: 'anywhere' }}>{meeting.groups || '—'}</span>
      <Territories meeting={meeting} />
    </div>
  );
}

function Territories({ meeting }: { meeting: ServiceMeetingRow }) {
  if (meeting.kind === 'domingo') {
    const entries = GROUPS.filter((g) => (meeting.group_territories[g]?.length ?? 0) > 0);
    if (entries.length === 0) return <span style={{ color: '#4A5363' }}>—</span>;
    return (
      <span
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '2px 16px',
          fontFamily: 'var(--tk-font-numeric)',
          fontWeight: 700,
        }}
      >
        {entries.map((g) => (
          <span key={g}>
            {g} {(meeting.group_territories[g] ?? []).join(',')}
          </span>
        ))}
      </span>
    );
  }
  if (meeting.territory_ids.length === 0) return <span style={{ color: '#4A5363' }}>—</span>;
  return (
    <span style={{ fontFamily: 'var(--tk-font-numeric)', fontWeight: 700 }}>
      {meeting.territory_ids.join(',')}
    </span>
  );
}
