import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import type { ServiceMeetingRow } from '@territorios/data';

// The card renders the whole week and is only needed when someone shares, so it loads on
// demand: the startup bundle never carries it.
const WeekShareCard = lazy(() =>
  import('./WeekShareCard').then((m) => ({ default: m.WeekShareCard })),
);

const TITLE = 'Salidas · Cong. Norte Villa Diego';

/**
 * "Compartir semana": renders the hidden `WeekShareCard` for the shown week and hands the PNG
 * to WhatsApp (or the download/clipboard fallback). Lives in the Salidas header.
 */
export function ShareWeekButton({
  monday,
  meetings,
}: {
  monday: string;
  meetings: ServiceMeetingRow[];
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  // Guards the export against re-entry (React Strict Mode runs effects twice in dev).
  const started = useRef(false);

  const onReady = useCallback((el: HTMLElement) => setNode(el), []);

  useEffect(() => {
    if (!node || started.current) return;
    started.current = true;
    void (async () => {
      try {
        // Loaded on first use together with html-to-image: neither ships in the startup bundle.
        const { shareNodeAsPng } = await import('../../lib/shareImage');
        await shareNodeAsPng(node, `salidas-${monday}.png`, TITLE);
      } catch {
        setFailed(true);
      } finally {
        started.current = false;
        setNode(null);
        setBusy(false);
      }
    })();
  }, [node, monday]);

  const exporting = busy || node !== null;

  return (
    <div data-export-hide className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-secondary inline-flex items-center justify-center gap-2"
        disabled={exporting}
        onClick={() => {
          setFailed(false);
          setBusy(true);
        }}
      >
        <Share2 aria-hidden size={24} />
        {exporting ? 'Preparando imagen…' : 'Compartir semana'}
      </button>
      {failed && (
        <p role="alert" className="text-secondary text-danger">
          No pudimos preparar la imagen. Probá de nuevo.
        </p>
      )}
      {busy && (
        <Suspense fallback={null}>
          <WeekShareCard monday={monday} meetings={meetings} onReady={onReady} />
        </Suspense>
      )}
    </div>
  );
}
