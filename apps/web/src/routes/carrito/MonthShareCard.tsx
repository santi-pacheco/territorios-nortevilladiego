import type { RefObject } from 'react';
import type { CartScheduleRow } from '@territorios/data';
import { longDate } from '../../lib/week';
import { shortRange } from '../programa/model';
import type { Turn, WeekSection } from './route';

const WIDTH = 1080;
const COLUMNS = '250px 160px minmax(0,1.25fr) minmax(0,1.55fr) minmax(0,1.15fr)';

/**
 * The whole schedule as one printable card, hidden off-screen and captured by
 * `shareNodeAsPng`. One row per turn, blackouts read "Sin carrito" in the people column.
 * The Carrito route is already a lazy chunk, so this renders with it (no extra startup cost).
 */
export function MonthShareCard({
  cardRef,
  schedule,
  sections,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  schedule: CartScheduleRow;
  sections: WeekSection[];
}) {
  return (
    <div aria-hidden style={{ position: 'fixed', left: -100_000, top: 0, pointerEvents: 'none' }}>
      <div
        ref={cardRef}
        style={{
          width: WIDTH,
          background: '#FFFFFF',
          color: '#14181F',
          fontFamily: 'var(--tk-font-ui)',
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <header>
          <h1 style={{ margin: 0, fontSize: 40, lineHeight: 1.2, fontWeight: 700 }}>
            Carrito · {schedule.name}
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 24, color: '#4A5363' }}>
            {shortRange(schedule.start_date, schedule.end_date)}
          </p>
        </header>
        {sections.map((section) => (
          <WeekBlock key={section.weekStart} section={section} />
        ))}
      </div>
    </div>
  );
}

function WeekBlock({ section }: { section: WeekSection }) {
  return (
    <section style={{ border: '2px solid #14181F' }}>
      <div
        style={{
          background: '#14181F',
          color: '#FFFFFF',
          padding: '8px 18px',
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        {section.heading}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          gap: 0,
          background: '#EEF1F4',
          padding: '6px 18px',
          fontSize: 17,
          fontWeight: 700,
        }}
      >
        <span>Día</span>
        <span>Horario</span>
        <span>Lugar</span>
        <span>Publicadores</span>
        <span>Nota</span>
      </div>
      {section.turns.map((turn, i) => (
        <TurnRow key={`${turn.date}-${turn.timeRange}-${i}`} turn={turn} last={i === section.turns.length - 1} />
      ))}
    </section>
  );
}

function TurnRow({ turn, last }: { turn: Turn; last: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: COLUMNS,
        alignItems: 'start',
        gap: '0 12px',
        padding: '10px 18px',
        fontSize: 22,
        lineHeight: 1.35,
        borderBottom: last ? 'none' : '1px solid #D5DBE4',
      }}
    >
      <span>
        <span style={{ fontWeight: 700 }}>{turn.weekday}</span>{' '}
        <span style={{ color: '#4A5363' }}>{longDate(turn.dateObj)}</span>
      </span>
      <span style={{ fontFamily: 'var(--tk-font-numeric)', fontWeight: 700 }}>{turn.timeRange}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, overflowWrap: 'anywhere' }}>
        {turn.placeColor && (
          <span
            style={{
              display: 'inline-block',
              width: 16,
              height: 16,
              flexShrink: 0,
              borderRadius: 3,
              border: '1px solid #8994A6',
              background: turn.placeColor,
            }}
          />
        )}
        {turn.place}
      </span>
      <span style={{ overflowWrap: 'anywhere' }}>
        {turn.isBlackout ? (
          <span style={{ color: '#4A5363' }}>Sin carrito</span>
        ) : (
          turn.people.join(', ')
        )}
      </span>
      <span style={{ color: '#4A5363', overflowWrap: 'anywhere' }}>{turn.note}</span>
    </div>
  );
}
