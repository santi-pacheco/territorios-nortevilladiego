import type { CSSProperties, RefObject } from 'react';
import { themes } from '@territorios/ui-tokens';
import type { MonthCell, MonthTable } from './monthTable';

/** Wide enough that the text stays readable once a phone fits the image to its screen. */
export const SHARE_WIDTH = 1600;
const WEEK_COL = 170;

// The image is always the light theme on white, whatever theme the app is showing.
const t = themes.light;
const INK = t.text.primary;
const SOFT = t.text.secondary;
const LINE = t.border.subtle;
const CANVAS = t.bg.canvas;
const SURFACE = t.bg.surface;
const DANGER = t.status.danger;

const cellBase: CSSProperties = {
  border: `1px solid ${LINE}`,
  padding: '12px 14px',
  verticalAlign: 'top',
  textAlign: 'left',
};

/**
 * The whole schedule as ONE monthly table (title, a column per turn, a row per week), hidden
 * off-screen and captured by `renderPng`. Blocked turns are merged into a banner with the reason.
 */
export function MonthShareCard({
  cardRef,
  table,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  table: MonthTable;
}) {
  const { columns, rows } = table;
  const colWidth = (SHARE_WIDTH - 2 * 40 - WEEK_COL) / Math.max(columns.length, 1);
  return (
    <div aria-hidden style={{ position: 'fixed', left: -100_000, top: 0, pointerEvents: 'none' }}>
      <div
        ref={cardRef}
        style={{
          width: SHARE_WIDTH,
          boxSizing: 'border-box',
          background: SURFACE,
          color: INK,
          fontFamily: 'var(--tk-font-ui)',
          padding: 40,
        }}
      >
        <h1
          style={{
            margin: '0 0 24px',
            fontSize: 48,
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: '0.01em',
            textTransform: 'uppercase',
          }}
        >
          {table.title}
        </h1>
        <table
          style={{
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
            fontSize: 23,
            lineHeight: 1.35,
          }}
        >
          <colgroup>
            <col style={{ width: WEEK_COL }} />
            {columns.map((c) => (
              <col key={c.slotId} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ background: CANVAS }}>
              <th scope="col" style={{ ...cellBase, color: SOFT, verticalAlign: 'middle' }}>
                SEMANA
              </th>
              {columns.map((c) => (
                <th key={c.slotId} scope="col" style={cellBase}>
                  <div style={{ fontSize: 20, color: SOFT, textTransform: 'uppercase' }}>
                    {c.day}
                  </div>
                  <div style={{ fontFamily: 'var(--tk-font-numeric)', fontSize: 22 }}>{c.time}</div>
                  <div style={{ fontSize: 20, color: SOFT, textTransform: 'uppercase' }}>
                    {c.place}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.weekStart}>
                <th scope="row" style={{ ...cellBase, verticalAlign: 'middle', fontWeight: 600 }}>
                  {row.label}
                </th>
                {row.cells.map((cell, i) => (
                  <Cell key={i} cell={cell} colWidth={colWidth} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Banner text size: big when the banner is wide, shrunk so the longest word fits one line. */
function bannerSize(reason: string, width: number): number {
  const longest = Math.max(...reason.split(/\s+/).map((w) => w.length), 1);
  const room = width - 2 * 16 - 2 * 14;
  // Uppercase bold runs ~0.8 em per glyph: size so the longest word never breaks mid-word.
  return Math.max(14, Math.min(44, Math.floor(room / (longest * 0.8))));
}

function Cell({ cell, colWidth }: { cell: MonthCell; colWidth: number }) {
  if (cell.kind === 'outside') {
    return <td style={{ ...cellBase, background: CANVAS }} />;
  }
  if (cell.kind === 'blocked') {
    return (
      <td colSpan={cell.span} style={{ ...cellBase, textAlign: 'center', verticalAlign: 'middle' }}>
        <span
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            padding: '14px 16px',
            borderRadius: 14,
            background: SURFACE,
            boxShadow: '0 4px 18px rgb(20 24 31 / 22%)',
            color: DANGER,
            fontSize: bannerSize(cell.reason, cell.span * colWidth),
            fontWeight: 700,
            lineHeight: 1.1,
            textTransform: 'uppercase',
            overflowWrap: 'break-word',
          }}
        >
          {cell.reason}
        </span>
      </td>
    );
  }
  return (
    <td style={cellBase}>
      {cell.people.map((name) => (
        <div key={name} style={{ overflowWrap: 'anywhere' }}>
          {name}
        </div>
      ))}
      {cell.note && (
        <div style={{ marginTop: 4, fontSize: 20, fontStyle: 'italic', color: SOFT }}>
          {cell.note}
        </div>
      )}
    </td>
  );
}
