import { Suspense, lazy, useState } from 'react';
import { Share2 } from 'lucide-react';

// The sheet, the document layout and its print CSS load only when someone opens it.
const ProgramShareSheet = lazy(() =>
  import('./ProgramShareSheet').then((m) => ({ default: m.ProgramShareSheet })),
);

/** "Compartir / Imprimir" in the Programa header; `monday` is the week on screen. */
export function ShareProgramButton({ monday }: { monday: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-secondary inline-flex items-center justify-center gap-2"
        onClick={() => setOpen(true)}
      >
        <Share2 aria-hidden size={24} />
        Compartir / Imprimir
      </button>
      {open && (
        <Suspense fallback={null}>
          <ProgramShareSheet monday={monday} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
