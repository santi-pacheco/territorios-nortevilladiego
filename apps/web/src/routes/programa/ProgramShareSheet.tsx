import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Printer, X } from 'lucide-react';
import { useProgramWeeks } from '@territorios/data';
import { platform } from '@territorios/platform';
import { addDaysIso } from '../../lib/week';
import { dayHeading, shortDay, shortRange } from './model';
import { ProgramDocument } from './ProgramDocument';
import {
  IMAGE_MAX_BLOCKS,
  MAX_RANGE_WEEKS,
  normalizeRange,
  presetRange,
  selectBlocks,
  type ShareKind,
  type SharePresetId,
  type ShareRange,
} from './shareModel';

// Only needed once an image exists, and it pulls the clipboard/share helpers with it.
const ShareImageSheet = lazy(() =>
  import('../../shell/ShareImageSheet').then((m) => ({ default: m.ShareImageSheet })),
);

const TITLE = 'Programa · Cong. Norte Villa Diego';

const KIND_LABEL: Record<ShareKind, string> = {
  both: 'Ambas reuniones',
  midweek: 'Entre semana',
  weekend: 'Fin de semana',
};

function presetLabels(monday: string): Array<{ id: SharePresetId; label: string }> {
  return [
    { id: 'midweek-1', label: `Entre semana · ${shortDay(addDaysIso(monday, 1))}` },
    { id: 'weekend-1', label: `Fin de semana · ${shortDay(addDaysIso(monday, 5))}` },
    { id: 'week-1', label: 'Semana completa (ambas reuniones)' },
    { id: 'midweeks-4', label: 'Próximas 4 de entre semana' },
    { id: 'weekends-4', label: 'Próximos 4 fines de semana' },
    { id: 'weeks-4', label: 'Próximas 4 semanas (ambas reuniones)' },
    { id: 'custom', label: 'Elegir fechas' },
  ];
}

/**
 * "Compartir / Imprimir" for Programa: pick one meeting or a range, then make a PNG or print it
 * on A4. Lazy-loaded from `ShareProgramButton`, so none of it is in the startup bundle.
 */
export function ProgramShareSheet({ monday, onClose }: { monday: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const docNode = useRef<HTMLElement | null>(null);
  const [preset, setPreset] = useState<SharePresetId>('week-1');
  const [custom, setCustom] = useState<ShareRange>(() => presetRange('weeks-4', monday));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const range = useMemo(
    () => (preset === 'custom' ? normalizeRange(custom) : presetRange(preset, monday)),
    [preset, custom, monday],
  );
  const query = useProgramWeeks(range?.from ?? monday, range?.to ?? monday);
  const blocks = useMemo(
    () => (range ? selectBlocks(query.data ?? [], range) : []),
    [query.data, range],
  );

  const onReady = useCallback((node: HTMLElement) => {
    docNode.current = node;
  }, []);

  const ready = range !== null && query.isSuccess && blocks.length > 0;
  const tooLong = blocks.length > IMAGE_MAX_BLOCKS;
  const canPrint = platform().kind === 'web' && typeof window.print === 'function';
  const caption = range ? shortRange(range.from, range.to) : '';

  async function makeImage() {
    const node = docNode.current;
    if (!node || !range) return;
    setFailed(false);
    setBusy(true);
    try {
      const { renderPng } = await import('../../lib/shareImage');
      setBlob(await renderPng(node));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="program-share-title"
      onClose={onClose}
      data-export-hide
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="program-share-title" className="text-heading font-bold">
            Compartir o imprimir
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Cerrar"
            onClick={() => ref.current?.close()}
          >
            <X aria-hidden size={24} />
          </button>
        </div>

        <fieldset className="flex flex-col border-t border-line">
          <legend className="sr-only">Qué incluir</legend>
          {presetLabels(monday).map(({ id, label }) => (
            <label
              key={id}
              className="flex min-h-touch cursor-pointer items-center gap-3 border-b border-line py-2"
            >
              <input
                type="radio"
                name="program-share-preset"
                className="h-5 w-5 shrink-0 accent-[var(--tk-text-primary)]"
                checked={preset === id}
                onChange={() => setPreset(id)}
              />
              <span className="text-body">{label}</span>
            </label>
          ))}
        </fieldset>

        {preset === 'custom' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-secondary text-ink-soft">
              Reunión
              <select
                className="field"
                value={custom.kind}
                onChange={(e) => setCustom({ ...custom, kind: e.target.value as ShareKind })}
              >
                {(Object.keys(KIND_LABEL) as ShareKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-secondary text-ink-soft">
              Desde
              <input
                type="date"
                className="field"
                value={custom.from}
                onChange={(e) => setCustom({ ...custom, from: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-secondary text-ink-soft">
              Hasta
              <input
                type="date"
                className="field"
                value={custom.to}
                onChange={(e) => setCustom({ ...custom, to: e.target.value })}
              />
            </label>
            <p className="text-secondary text-ink-soft sm:col-span-3">
              Hasta {MAX_RANGE_WEEKS} semanas por vez.
            </p>
          </div>
        )}

        <div role="status" className="min-h-[3.5rem] text-secondary">
          {range === null ? (
            <p className="text-ink-soft">Elegí las dos fechas.</p>
          ) : query.isPending ? (
            <div aria-busy="true" aria-label="Buscando el programa" className="skeleton h-12 w-full" />
          ) : query.isError && !query.data ? (
            <p className="text-danger">No pudimos cargar el programa. Revisá la conexión.</p>
          ) : blocks.length === 0 ? (
            <p className="text-ink-soft">
              Todavía no hay programa cargado para esas fechas. Cuando lo publiquen, aparece acá.
            </p>
          ) : (
            <p className="text-ink-soft">
              {blocks.length === 1
                ? blocks[0]!.kind === 'assembly'
                  ? 'Semana de asamblea'
                  : dayHeading(blocks[0]!.date)
                : `${blocks.length} reuniones · ${caption}`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
            disabled={!ready || tooLong || busy}
            onClick={() => void makeImage()}
          >
            <ImageIcon aria-hidden size={22} />
            {busy ? 'Preparando imagen…' : 'Crear imagen'}
          </button>
          {canPrint && (
            <button
              type="button"
              className="btn-secondary inline-flex flex-1 items-center justify-center gap-2"
              disabled={!ready}
              onClick={() => window.print()}
            >
              <Printer aria-hidden size={22} />
              Imprimir
            </button>
          )}
        </div>
        {tooLong && ready && (
          <p className="text-secondary text-ink-soft">
            La imagen admite hasta {IMAGE_MAX_BLOCKS} reuniones. Acortá las fechas o imprimí.
          </p>
        )}
        {failed && (
          <p role="alert" className="text-secondary text-danger">
            No pudimos preparar la imagen. Probá de nuevo.
          </p>
        )}
      </div>

      {ready && range && <ProgramDocument blocks={blocks} caption={caption} onReady={onReady} />}

      {blob && range && (
        <Suspense fallback={null}>
          <ShareImageSheet
            blob={blob}
            fileName={`programa-${range.from}${range.to === range.from ? '' : `_${range.to}`}.png`}
            title={TITLE}
            onClose={() => setBlob(null)}
          />
        </Suspense>
      )}
    </dialog>
  );
}
