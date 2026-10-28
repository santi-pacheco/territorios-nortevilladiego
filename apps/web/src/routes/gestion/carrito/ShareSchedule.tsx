/**
 * Renders the preview as the same monthly table the public Carrito screen shares, then hands the
 * PNG to the shared sheet. Loaded on demand: the card, `html-to-image` and the sheet only
 * cost anything once someone taps "Compartir imagen".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WeeksSource } from '../../carrito/weeks';
import { MonthShareCard } from '../../carrito/MonthShareCard';
import { buildMonthTable } from '../../carrito/monthTable';
import { shortRange } from '../../programa/model';
import { renderPng } from '../../../lib/shareImage';
import { ShareImageSheet } from '../../../shell/ShareImageSheet';

export default function ShareSchedule({
  source,
  name,
  startDate,
  endDate,
  onDone,
}: {
  source: WeeksSource;
  name: string;
  startDate: string;
  endDate: string;
  /** Called when the sheet closes or the image could not be made (`failed`). */
  onDone: (failed: boolean) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const table = useMemo(() => buildMonthTable(source), [source]);

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
      <MonthShareCard cardRef={cardRef} table={table} />
      {blob && (
        <ShareImageSheet
          blob={blob}
          fileName={`carrito-${startDate}.png`}
          title={`${name} · ${shortRange(startDate, endDate)}`}
          onClose={() => onDone(false)}
        />
      )}
    </>
  );
}
