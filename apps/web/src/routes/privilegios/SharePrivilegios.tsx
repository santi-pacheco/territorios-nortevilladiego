/**
 * Renders the month's privilegios as a light table card (same columns and rows as on screen),
 * then hands the PNG to the shared sheet. Loaded on demand: the card, `html-to-image` and the
 * sheet only cost anything once someone taps "Compartir imagen".
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { themes } from '@territorios/ui-tokens';
import type { DutyRole } from '@territorios/data';
import { renderPng } from '../../lib/shareImage';
import { ShareImageSheet } from '../../shell/ShareImageSheet';
import {
  bannerText,
  dayNumber,
  mesParam,
  monthLabel,
  namesFor,
  weekdayShort,
  type Month,
  type RosterDay,
} from './model';

const SHARE_WIDTH = 1600;
const DATE_COL = 190;

// The image is always the light theme on white, whatever theme the app is showing.
const t = themes.light;
const INK = t.text.primary;
const SOFT = t.text.secondary;
const LINE = t.border.subtle;
const CANVAS = t.bg.canvas;
const SURFACE = t.bg.surface;

const cellBase: CSSProperties = {
  border: `1px solid ${LINE}`,
  padding: '12px 14px',
  verticalAlign: 'top',
  textAlign: 'left',
};

export default function SharePrivilegios({
  month,
  days,
  columns,
  congregation,
  onDone,
}: {
  month: Month;
  days: RosterDay[];
  columns: { role: DutyRole; label: string }[];
  congregation: string;
  /** Called when the sheet closes or the image could not be made (`failed`). */
  onDone: (failed: boolean) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const period = monthLabel(month);

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    let cancelled = false;
    renderPng(node, 1).then(
      (png) => {
        if (!cancelled) setBlob(png);
      },
      () => {
        if (!cancelled) onDone(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // The card is built once per tap; later edits take a new tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
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
              margin: 0,
              fontSize: 48,
              lineHeight: 1.15,
              fontWeight: 700,
              letterSpacing: '0.01em',
              textTransform: 'uppercase',
            }}
          >
            Privilegios · {period}
          </h1>
          <p style={{ margin: '4px 0 24px', fontSize: 24, color: SOFT }}>{congregation}</p>
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
              <col style={{ width: DATE_COL }} />
              {columns.map((c) => (
                <col key={c.role} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: CANVAS }}>
                <th scope="col" style={{ ...cellBase, color: SOFT }}>
                  FECHA
                </th>
                {columns.map((c) => (
                  <th key={c.role} scope="col" style={{ ...cellBase, color: SOFT }}>
                    {c.label.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row" style={{ ...cellBase, fontWeight: 600 }}>
                    <span style={{ color: SOFT, fontSize: 20, textTransform: 'uppercase' }}>
                      {weekdayShort(day.date)}
                    </span>{' '}
                    <span style={{ fontFamily: 'var(--tk-font-numeric)', fontSize: 28 }}>
                      {dayNumber(day.date)}
                    </span>
                  </th>
                  {day.kind === 'normal' ? (
                    columns.map((c) => (
                      <td key={c.role} style={cellBase}>
                        {namesFor(day, c.role).map((r) => (
                          <div key={r.id} style={{ overflowWrap: 'anywhere' }}>
                            {r.person_name}
                          </div>
                        ))}
                      </td>
                    ))
                  ) : (
                    <td
                      colSpan={columns.length}
                      style={{ ...cellBase, textAlign: 'center', fontWeight: 700, color: SOFT }}
                    >
                      {bannerText(day)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {blob && (
        <ShareImageSheet
          blob={blob}
          fileName={`privilegios-${mesParam(month)}.png`}
          title={`Privilegios · ${period}`}
          onClose={() => onDone(false)}
        />
      )}
    </>
  );
}
