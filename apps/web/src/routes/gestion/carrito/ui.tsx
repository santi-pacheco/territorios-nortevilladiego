/**
 * Small shared pieces for the Gestión ▸ Carrito screen: the sub-tab segmented control,
 * the `<dialog>` sheet, in-row delete confirmation, the CAS conflict bar and a
 * consistent write-error helper. Nothing here touches Supabase.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { DataError, SchemaError, isConflictError, isNetworkError } from '@territorios/data';

// ---------------------------------------------------------------------------
// Segmented sub-tabs (one DOM tree; radio group, same pattern as the theme picker)
// ---------------------------------------------------------------------------
export interface TabSpec<T extends string> {
  value: T;
  label: string;
}

export function SubTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: readonly TabSpec<T>[];
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Secciones del carrito">
      {tabs.map((tab) => (
        <label key={tab.value} className="segmented-item">
          <input
            type="radio"
            name="carrito-tab"
            value={tab.value}
            checked={value === tab.value}
            onChange={() => onChange(tab.value)}
          />
          <span>{tab.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet built on <dialog> (native focus trap, Esc to close, inert background)
// ---------------------------------------------------------------------------
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-heading font-bold">
          {title}
        </h2>
        <button
          type="button"
          className="icon-btn -mr-2 -mt-1"
          aria-label="Cerrar"
          onClick={() => ref.current?.close()}
        >
          <X aria-hidden size={24} />
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-5">{children}</div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// In-row delete confirmation (no window.confirm)
// ---------------------------------------------------------------------------
/** Two-step delete: first press arms it, second press deletes. One DOM node. */
export function DeleteButton({
  onConfirm,
  busy,
  label = 'Eliminar',
}: {
  onConfirm: () => void;
  busy?: boolean;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary text-danger"
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {busy ? 'Eliminando…' : `Sí, ${label.toLowerCase()}`}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setArmed(false)}>
        Cancelar
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Conflict / error handling
// ---------------------------------------------------------------------------
export interface ConflictPrompt {
  /** What was being edited, e.g. "El lugar". */
  what: string;
  /** The server row's version when the conflict was detected. */
  version: number;
  /** Re-applies the local change on top of `version`. */
  retry: (version: number) => void;
  /** The server row as it stands now (to reset the form on "Usar lo de ellos"). */
  current: unknown;
}

export interface WriteState {
  prompt: ConflictPrompt | null;
  error: string | null;
  /**
   * Returns true when the error was handled: a CAS conflict (shown with both choices), a row
   * deleted by someone else, or a probable permission denial (both shown as plain errors).
   */
  report: (error: unknown, what: string, retry: (version: number) => void) => boolean;
  setError: (message: string | null) => void;
  clearPrompt: () => void;
}

function rowVersion(row: unknown): number | null {
  const v = (row as { version?: unknown } | null)?.version;
  return typeof v === 'number' ? v : null;
}

export function errorMessage(error: unknown): string {
  if (isNetworkError(error)) return 'Sin conexión. El cambio se reintenta cuando vuelva.';
  if (error instanceof DataError) {
    return error.isUniqueViolation
      ? 'Ya existía un registro igual. Recargá para ver lo último.'
      : 'No se pudo guardar el cambio.';
  }
  if (error instanceof SchemaError) return 'El servidor devolvió datos inesperados.';
  return 'No se pudo guardar el cambio.';
}

/** Tracks a CAS conflict (shown inline) plus the non-conflict error text. */
export function useWriteState(): WriteState {
  const [prompt, setPrompt] = useState<ConflictPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  return {
    prompt,
    error,
    report(nextError, what, retry) {
      if (!isConflictError(nextError)) return false;
      if (nextError.deleted) {
        setPrompt(null);
        setError(`${what} ya no existe: lo borró otra persona.`);
        return true;
      }
      if (nextError.likelyPermissionDenied) {
        setPrompt(null);
        setError('No tenés permiso para guardar este cambio. Entrá con tu cuenta de encargado.');
        return true;
      }
      const version = rowVersion(nextError.current);
      if (version === null) return false;
      setError(null);
      setPrompt({ what, version, retry, current: nextError.current });
      return true;
    },
    setError,
    clearPrompt: () => setPrompt(null),
  };
}

/**
 * Inline "Alguien cambió esto" bar. "Usar lo de ellos" drops the prompt and lets the caller
 * reset its form from `prompt.current`; "Guardar lo mío" re-applies on the server version.
 */
export function ConflictBar({
  write,
  onUseTheirs,
}: {
  write: WriteState;
  /** Discard local edits (reset the form or close the sheet). Called after the prompt clears. */
  onUseTheirs?: (current: unknown) => void;
}) {
  const { prompt, error } = write;
  if (!prompt && !error) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-sm border border-line-strong bg-surface px-3 py-3"
    >
      {prompt && (
        <>
          <p className="text-body">
            <strong>Alguien cambió esto.</strong> {prompt.what} tiene una versión más nueva.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                write.clearPrompt();
                onUseTheirs?.(prompt.current);
              }}
            >
              Usar lo de ellos
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                write.clearPrompt();
                prompt.retry(prompt.version);
              }}
            >
              Guardar lo mío
            </button>
          </div>
        </>
      )}
      {error && <p className="text-body text-danger">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <h3 className="text-body-strong font-semibold">{title}</h3>
      <p className="max-w-prose text-body text-ink-soft">{body}</p>
      {children}
    </div>
  );
}

export function TabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="flex flex-col gap-3">
      <div className="skeleton h-11 w-full" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="skeleton h-14 w-full" />
      ))}
    </div>
  );
}

/** Reusable labelled field wrapper (keeps the row layout responsive, one DOM tree). */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ''}`}>
      <span className="text-secondary text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
