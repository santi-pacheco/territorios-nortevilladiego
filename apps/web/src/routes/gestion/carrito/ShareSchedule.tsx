/**
 * Renders the preview as the same month card the public Carrito screen shares, then hands the
 * PNG to the shared sheet. Loaded on demand: the card, `html-to-image` and the sheet only
 * cost anything once someone taps "Compartir imagen".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWeeks, type WeeksSource } from '../../carrito/weeks';
import { MonthShareCard } from '../../carrito/MonthShareCard';
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
  const sections = useMemo(() => buildWeeks(source, ''), [source]);
  const schedule = useMemo(
    () => ({ name, start_date: startDate, end_date: endDate }),
    [name, startDate, endDate],
  );

  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    let cancelled = false;
    renderPng(node).then(
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
      <MonthShareCard cardRef={cardRef} schedule={schedule} sections={sections} />
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
