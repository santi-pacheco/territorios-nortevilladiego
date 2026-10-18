/**
 * One weekend meeting as a controlled form: the fields the printed programme carries
 * (presidente, discurso, conductor, lector, oración final, asamblea). The discourse is
 * optional — the toggle adds a `WeekendDiscourse`, matching the core type `discurso: ... | null`.
 *
 * Fields the editor does not show (canciones, `discurso.saliente`) stay in the value and are
 * round-tripped untouched on save. Every person is a PersonPicker (linked to the directory);
 * only the orador accepts free text, for visiting speakers.
 */
import { useId } from 'react';
import type { WeekendPersonField } from '@territorios/core';
import { PersonPicker } from '../../../../shell/PersonPicker';
import { DISCOURSE_TIPOS, NO_PERSON, type DiscourseDraft, type WeekendDraft } from './model';

function newDiscourse(): DiscourseDraft {
  return { tipo: 'PÚBLICO', titulo: '', orador: NO_PERSON, congregacion: null, saliente: null };
}

const PERSON_FIELDS: { key: WeekendPersonField; label: string }[] = [
  { key: 'presidente', label: 'Presidente' },
  { key: 'conductor', label: 'Conductor de La Atalaya' },
  { key: 'lector', label: 'Lector' },
  { key: 'oracionFinal', label: 'Oración final' },
];

export function WeekendEditor({
  value,
  onChange,
}: {
  value: WeekendDraft;
  onChange: (meeting: WeekendDraft) => void;
}) {
  const id = useId();
  const disc = value.discurso;

  const text = (key: 'asamblea') => value[key] ?? '';
  const setText = (key: 'asamblea', v: string) => onChange({ ...value, [key]: v });
  const setDisc = (patch: Partial<DiscourseDraft>) =>
    onChange({ ...value, discurso: { ...(disc ?? newDiscourse()), ...patch } });

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <h4 id={`${id}-h`} className="text-heading font-bold">
        Reunión del fin de semana
      </h4>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PERSON_FIELDS.map(({ key, label }) => (
          <PersonPicker
            key={key}
            label={label}
            value={value[key]}
            onChange={(v) => onChange({ ...value, [key]: v })}
          />
        ))}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3">
        <legend className="px-1 text-secondary font-semibold text-ink-soft">Discurso</legend>
        {disc ? (
          <>
            <label htmlFor={`${id}-tipo`} className="flex flex-col gap-1">
              <span className="text-secondary text-ink-soft">Tipo</span>
              <select
                id={`${id}-tipo`}
                className="field"
                value={disc.tipo}
                onChange={(e) => setDisc({ tipo: e.currentTarget.value })}
              >
                {!(DISCOURSE_TIPOS as readonly string[]).includes(disc.tipo) && (
                  <option value={disc.tipo}>{disc.tipo || 'Elegí el tipo'}</option>
                )}
                <option value="PÚBLICO">Público</option>
                <option value="ESPECIAL">Especial</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-secondary text-ink-soft">Título</span>
              <input
                className="field"
                value={disc.titulo}
                onChange={(e) => setDisc({ titulo: e.currentTarget.value })}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PersonPicker
                label="Orador"
                value={disc.orador}
                // A visiting speaker is not in the directory: free text is allowed here only.
                allowFreeText
                onChange={(v) => setDisc({ orador: v })}
              />
              <label className="flex flex-col gap-1">
                <span className="text-secondary text-ink-soft">Congregación</span>
                <input
                  className="field"
                  value={disc.congregacion ?? ''}
                  onChange={(e) => setDisc({ congregacion: e.currentTarget.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-secondary self-start"
              onClick={() => onChange({ ...value, discurso: null })}
            >
              Quitar discurso
            </button>
          </>
        ) : (
          <>
            <p className="text-body text-ink-soft">Esta semana no tiene discurso cargado.</p>
            <button
              type="button"
              className="btn-secondary self-start"
              onClick={() => onChange({ ...value, discurso: newDiscourse() })}
            >
              Agregar discurso
            </button>
          </>
        )}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-secondary text-ink-soft">Asamblea</span>
        <input
          className="field"
          value={text('asamblea')}
          placeholder="Asamblea de circuito"
          onChange={(e) => setText('asamblea', e.currentTarget.value)}
        />
        <span className="text-secondary text-ink-soft">
          Si la semana tiene asamblea, el discurso es el de la asamblea.
        </span>
      </label>
    </section>
  );
}
