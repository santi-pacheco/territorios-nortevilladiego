/**
 * One midweek meeting as a controlled form: an "Asamblea" note (which hides the parts, as an
 * assembly week has no parts) plus a list of parts. Each part carries a section, a time, a
 * title and its assigned people, and can be reordered or removed.
 *
 * The state lives in the parent (`WeekForm`); this component only renders `value` and calls
 * `onChange` with a new value. All the transforms are pure helpers from `./model`.
 *
 * "Traer de la Guía de actividades" asks the parent for a proposal (`./guide`); it is shown as a
 * list of changes with "Aplicar" / "Descartar" and only touches the form when applied.
 */
import { useId } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import type { MidweekPart, MidweekSection, MidweekWeek, ProgramaPerson } from '@territorios/core';
import type { GuideProposal } from './guide';
import {
  SECTION_LABEL,
  SECTION_ORDER,
  addPart,
  addPerson,
  movePart,
  removePart,
  removePerson,
  setPart,
  setPerson,
} from './model';

export function MidweekEditor({
  value,
  onChange,
  onCopyPrevious,
  copying,
  note,
  onFetchGuide,
  fetchingGuide,
  proposal,
  onApplyGuide,
  onDiscardGuide,
}: {
  value: MidweekWeek;
  onChange: (week: MidweekWeek) => void;
  onCopyPrevious: () => void;
  copying: boolean;
  note: string | null;
  onFetchGuide: () => void;
  fetchingGuide: boolean;
  proposal: GuideProposal | null;
  onApplyGuide: () => void;
  onDiscardGuide: () => void;
}) {
  const id = useId();
  const asamblea = value.asamblea ?? '';
  const setParts = (parts: MidweekPart[]) => onChange({ ...value, parts });

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <h4 id={`${id}-h`} className="text-heading font-bold">
        Reunión de entre semana
      </h4>

      <label className="flex flex-col gap-1">
        <span className="text-secondary text-ink-soft">Asamblea</span>
        <input
          className="field"
          value={asamblea}
          placeholder="Asamblea de circuito"
          onChange={(e) => onChange({ ...value, asamblea: e.currentTarget.value })}
        />
        <span className="text-secondary text-ink-soft">
          Si la semana tiene asamblea, no se cargan partes.
        </span>
      </label>

      {asamblea.trim() ? (
        <p className="text-body text-ink-soft">
          Esta semana es de asamblea: las partes no se muestran.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              onClick={() => setParts(addPart(value.parts))}
            >
              <Plus aria-hidden size={20} />
              Agregar parte
            </button>
            <button type="button" className="btn-secondary" disabled={copying} onClick={onCopyPrevious}>
              {copying ? 'Copiando…' : 'Copiar estructura de la semana anterior'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={fetchingGuide}
              onClick={onFetchGuide}
            >
              {fetchingGuide ? 'Trayendo…' : 'Traer de la Guía de actividades'}
            </button>
          </div>

          {proposal && (
            <GuidePreview proposal={proposal} onApply={onApplyGuide} onDiscard={onDiscardGuide} />
          )}

          {note && (
            <p role="status" className="text-secondary text-ink-soft">
              {note}
            </p>
          )}

          {value.parts.length === 0 ? (
            <p className="text-body text-ink-soft">
              Todavía no hay partes. Agregá la primera o copiá la semana anterior.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {value.parts.map((part, index) => (
                <PartRow
                  key={index}
                  part={part}
                  index={index}
                  count={value.parts.length}
                  onPatch={(patch) => setParts(setPart(value.parts, index, patch))}
                  onRemove={() => setParts(removePart(value.parts, index))}
                  onMove={(delta) => setParts(movePart(value.parts, index, delta))}
                  onAddPerson={() => setParts(addPerson(value.parts, index))}
                  onRemovePerson={(personIndex) => setParts(removePerson(value.parts, index, personIndex))}
                  onPersonChange={(personIndex, patch) =>
                    setParts(setPerson(value.parts, index, personIndex, patch))
                  }
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function GuidePreview({
  proposal,
  onApply,
  onDiscard,
}: {
  proposal: GuideProposal;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const id = useId();
  return (
    <div
      role="region"
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3"
    >
      <p id={`${id}-h`} className="text-body-strong font-bold">
        Guía de actividades: cambios para esta semana
      </p>
      {proposal.changes.length === 0 ? (
        <p className="text-body text-ink-soft">La semana ya coincide con la Guía.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
          {proposal.changes.map((change, i) => (
            <li key={i}>{change}</li>
          ))}
        </ul>
      )}
      {proposal.keptNames > 0 && (
        <p className="text-secondary text-ink-soft">
          {proposal.keptNames === 1
            ? 'Una parte conserva sus nombres.'
            : `${proposal.keptNames} partes conservan sus nombres.`}
        </p>
      )}
      <p className="text-secondary text-ink-soft">
        Nada se guarda hasta que toques “Guardar semana”.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onApply}>
          Aplicar
        </button>
        <button type="button" className="btn-secondary" onClick={onDiscard}>
          Descartar
        </button>
      </div>
    </div>
  );
}

function PartRow({
  part,
  index,
  count,
  onPatch,
  onRemove,
  onMove,
  onAddPerson,
  onRemovePerson,
  onPersonChange,
}: {
  part: MidweekPart;
  index: number;
  count: number;
  onPatch: (patch: Partial<MidweekPart>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onAddPerson: () => void;
  onRemovePerson: (personIndex: number) => void;
  onPersonChange: (personIndex: number, patch: Partial<ProgramaPerson>) => void;
}) {
  const id = useId();
  return (
    <li className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold text-ink-soft">Parte {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            aria-label="Mover la parte arriba"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden size={24} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Mover la parte abajo"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden size={24} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Quitar la parte"
            onClick={onRemove}
          >
            <Trash2 aria-hidden size={24} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Título</span>
          <input
            className="field"
            value={part.title}
            onChange={(e) => onPatch({ title: e.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Hora</span>
          <input
            className="field font-mono"
            inputMode="numeric"
            placeholder="19:06"
            value={part.time}
            onChange={(e) => onPatch({ time: e.currentTarget.value })}
          />
        </label>
      </div>

      <label htmlFor={`${id}-section`} className="flex flex-col gap-1">
        <span className="text-secondary text-ink-soft">Sección</span>
        <select
          id={`${id}-section`}
          className="field"
          value={part.section}
          onChange={(e) => onPatch({ section: e.currentTarget.value as MidweekSection })}
        >
          {SECTION_ORDER.map((section) => (
            <option key={section} value={section}>
              {SECTION_LABEL[section]}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-secondary text-ink-soft">Asignados</legend>
        {part.people.map((person, personIndex) => (
          <div
            key={personIndex}
            className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <label className="flex flex-col gap-1">
              <span className="sr-only">Nombre</span>
              <input
                className="field"
                placeholder="Nombre"
                value={person.name}
                onChange={(e) => onPersonChange(personIndex, { name: e.currentTarget.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="sr-only">Rol</span>
              <input
                className="field"
                placeholder="Rol (Presidente, Lector…)"
                value={person.role ?? ''}
                onChange={(e) => onPersonChange(personIndex, { role: e.currentTarget.value })}
              />
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Quitar a ${person.name || 'esta persona'}`}
              onClick={() => onRemovePerson(personIndex)}
            >
              <X aria-hidden size={24} />
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary self-start" onClick={onAddPerson}>
          Agregar asignado
        </button>
      </fieldset>
    </li>
  );
}
