/**
 * One directory row: name, gender, "En carrito" switch, duty chips and other spellings.
 * Every change is a CAS update of the people row (optimistic); a conflict shows the inline
 * "Alguien cambió esto" bar. The row's controls wait while its own write is in flight, so
 * two quick toggles never race on the same version.
 */
import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Plus, X } from 'lucide-react';
import {
  DataError,
  qk,
  useAddPersonAlias,
  useUpdatePerson,
  type PersonRow,
  type PersonUpdate,
} from '@territorios/data';
import { ConflictBar, errorMessage, useWriteState } from '../carrito/ui';
import { DUTY_LABEL, DUTY_ORDER, mergeAlias, removeAlias, toggleDuty } from './model';

const GENDER_LABEL = { M: 'Varón', F: 'Mujer' } as const;

export function PersonItem({ person }: { person: PersonRow }) {
  const qc = useQueryClient();
  const update = useUpdatePerson();
  const addAlias = useAddPersonAlias();
  const write = useWriteState();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const nameId = useId();
  const aliasInputId = useId();
  const busy = update.isPending || addAlias.isPending;

  async function save(patch: PersonUpdate, version = person.version) {
    // aria-disabled instead of disabled while a write is in flight, so focus stays put.
    if (busy) return;
    write.setError(null);
    try {
      await update.mutateAsync({ id: person.id, version, patch });
    } catch (error) {
      if (!write.report(error, person.name, (v) => void save(patch, v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  async function submitAlias() {
    setAliasError(null);
    const merged = mergeAlias(person.name, person.aliases, draft);
    if (!merged) {
      if (draft.trim()) setAliasError('Ese nombre ya está en la lista.');
      return;
    }
    const alias = merged[merged.length - 1] as string;
    try {
      await addAlias.mutateAsync({ personId: person.id, alias });
      setDraft('');
      setAdding(false);
    } catch (error) {
      setAliasError(
        error instanceof DataError && error.isUniqueViolation
          ? `“${alias}” ya corresponde a otra persona.`
          : errorMessage(error),
      );
    }
  }

  return (
    <li className="ps-row" aria-busy={busy || undefined}>
      <div className="ps-row-head">
        <p id={nameId} className="min-w-0 break-words">
          <span className="text-body-strong font-semibold">{person.name}</span>
          <span className="ml-2 text-secondary text-ink-soft">{GENDER_LABEL[person.gender]}</span>
        </p>
        <label className="ps-switch">
          <input
            type="checkbox"
            role="switch"
            checked={person.in_carrito}
            aria-disabled={busy || undefined}
            onChange={(e) => void save({ in_carrito: e.target.checked })}
          />
          <span>En carrito</span>
        </label>
      </div>

      <div className="ps-chips" role="group" aria-label={`Privilegios de ${person.name}`}>
        {DUTY_ORDER.map((duty) => {
          const on = person.duties.includes(duty);
          return (
            <button
              key={duty}
              type="button"
              className="ps-chip"
              aria-pressed={on}
              aria-disabled={busy || undefined}
              onClick={() => void save({ duties: toggleDuty(person.duties, duty) })}
            >
              {on && <Check aria-hidden size={18} strokeWidth={2.5} />}
              {DUTY_LABEL[duty]}
            </button>
          );
        })}
      </div>

      <div className="ps-aliases">
        <span className="text-secondary text-ink-soft">También escrito como</span>
        <ul className="ps-alias-list">
          {person.aliases.map((alias) => (
            <li key={alias} className="ps-alias">
              <span className="min-w-0 break-words">{alias}</span>
              <button
                type="button"
                className="ps-alias-remove"
                aria-label={`Quitar “${alias}”`}
                aria-disabled={busy || undefined}
                onClick={() => void save({ aliases: removeAlias(person.aliases, alias) })}
              >
                <X aria-hidden size={18} />
              </button>
            </li>
          ))}
          {!adding && (
            <li>
              <button
                type="button"
                className="ps-alias-add"
                disabled={busy || person.aliases.length >= 20}
                onClick={() => setAdding(true)}
              >
                <Plus aria-hidden size={18} />
                Agregar
              </button>
            </li>
          )}
        </ul>
        {adding && (
          <form
            className="ps-alias-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitAlias();
            }}
          >
            <label htmlFor={aliasInputId} className="sr-only">
              Otra forma de escribir {person.name}
            </label>
            <input
              id={aliasInputId}
              className="field min-w-0 flex-1"
              value={draft}
              autoComplete="off"
              autoFocus
              maxLength={120}
              placeholder="Ej: A. Pérez"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setAdding(false);
                  setDraft('');
                  setAliasError(null);
                }
              }}
            />
            <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>
              {addAlias.isPending ? 'Guardando…' : 'Agregar'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setAdding(false);
                setDraft('');
                setAliasError(null);
              }}
            >
              Cancelar
            </button>
          </form>
        )}
        {aliasError && (
          <p role="alert" className="text-secondary text-danger">
            {aliasError}
          </p>
        )}
      </div>

      <ConflictBar write={write} onUseTheirs={() => void qc.invalidateQueries({ queryKey: qk.people })} />
    </li>
  );
}
