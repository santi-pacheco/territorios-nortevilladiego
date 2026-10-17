import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, Share2, X } from 'lucide-react';
import {
  canCopyImage,
  canShareImage,
  copyImage,
  downloadImage,
  shareImage,
} from '../lib/shareImage';

type Status = { kind: 'idle' } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

/**
 * Preview of a ready image with one action per tap: copy (main), share sheet, download.
 * Each action runs inside its own tap, which browsers require for clipboard and share.
 */
export function ShareImageSheet({
  blob,
  fileName,
  title,
  onClose,
}: {
  blob: Blob;
  fileName: string;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const copyOk = canCopyImage();
  const shareOk = useMemo(() => canShareImage(blob, fileName), [blob, fileName]);

  useEffect(() => {
    ref.current?.showModal();
    return () => URL.revokeObjectURL(url);
  }, [url]);

  async function run(action: () => Promise<void> | void, done: string) {
    try {
      await action();
      setStatus({ kind: 'done', text: done });
    } catch (e) {
      // A dismissed share sheet is not an error worth showing.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setStatus({ kind: 'error', text: 'No se pudo. Probá con otra opción.' });
    }
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="share-title"
      onClose={onClose}
      data-export-hide
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="share-title" className="text-heading font-bold">
            Imagen lista
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
        <img
          src={url}
          alt={title}
          className="max-h-[45dvh] w-full rounded-md border border-line object-contain"
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          {copyOk && (
            <button
              type="button"
              className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
              onClick={() => run(() => copyImage(blob), 'Imagen copiada. Pegala en WhatsApp.')}
            >
              <Copy aria-hidden size={22} />
              Copiar imagen
            </button>
          )}
          {shareOk && (
            <button
              type="button"
              className={`${copyOk ? 'btn-secondary' : 'btn-primary'} inline-flex flex-1 items-center justify-center gap-2`}
              onClick={() => run(() => shareImage(blob, fileName, title), 'Listo.')}
            >
              <Share2 aria-hidden size={22} />
              Compartir
            </button>
          )}
          <button
            type="button"
            className="btn-secondary inline-flex flex-1 items-center justify-center gap-2"
            onClick={() => run(() => downloadImage(blob, fileName), 'Imagen descargada.')}
          >
            <Download aria-hidden size={22} />
            Descargar
          </button>
        </div>
        {status.kind !== 'idle' && (
          <p
            role="status"
            className={`inline-flex items-center gap-2 text-secondary ${status.kind === 'error' ? 'text-danger' : 'text-ok'}`}
          >
            {status.kind === 'done' && <Check aria-hidden size={18} />}
            {status.text}
          </p>
        )}
      </div>
    </dialog>
  );
}
