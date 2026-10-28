/** Form to block a week or one turn: a reason (default "Asamblea") and the quick suggestions. */
import { useState } from 'react';
import { Ban } from 'lucide-react';
import { DEFAULT_REASON, REASON_MAX, REASON_SUGGESTIONS } from './blackouts';
import { Field, Sheet } from './ui';

export function BlockSheet({
  label,
  whole,
  busy,
  error,
  onBlock,
  onClose,
}: {
  /** What is being blocked, e.g. "Semana del 5 de octubre". */
  label: string;
  /** True for a whole week (the text says every turn of it). */
  whole: boolean;
  busy: boolean;
  error: string | null;
  onBlock: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(DEFAULT_REASON);
  return (
    <Sheet title="Bloquear" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onBlock(reason);
        }}
      >
        <p className="text-body">
          {whole ? 'Se bloquean todos los turnos de ' : 'Se bloquea '}
          <strong>{label}</strong>. Sobre los turnos bloqueados se muestra el motivo y no se asignan
          personas.
        </p>
        <Field label="Motivo">
          <input
            className="field"
            value={reason}
            maxLength={REASON_MAX}
            autoComplete="off"
            placeholder="Sin motivo: dice «Sin carrito»"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos frecuentes">
          {REASON_SUGGESTIONS.map((text) => (
            <button
              key={text}
              type="button"
              className="btn-secondary"
              aria-pressed={reason === text}
              onClick={() => setReason(text)}
            >
              {text}
            </button>
          ))}
        </div>
        <p className="text-secondary text-ink-soft">
          El bloqueo se guarda al instante y lo ve todo el mundo; no hace falta publicar.
        </p>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-2"
            disabled={busy}
          >
            <Ban aria-hidden size={20} />
            {busy ? 'Bloqueando…' : 'Bloquear'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
