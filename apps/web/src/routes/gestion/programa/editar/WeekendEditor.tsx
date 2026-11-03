/**
 * One weekend meeting as a controlled form: the fields the printed programme carries
 * (canciones, presidente, discurso, conductor, lector, oración final, asamblea). The discourse is
 * optional — the toggle adds a `WeekendDiscourse`, matching the core type `discurso: ... | null`.
 *
 * The three songs are free text (number + title). Every person is a PersonPicker (linked to the
 * directory), except the orador: a visiting speaker, plain free text, never linked.
 * "Discursantes salientes" closes the form: none, one or many entries, each a directory person
 * (search and select, no free text) plus the free-text congregation they go to.
 */
import { useId } from 'react';
import type { WeekendPersonField } from '@territorios/core';
import { PersonPicker } from '../../../../shell/PersonPicker';
import { DISCOURSE_TIPOS, NO_SALIENTE, type DiscourseDraft, type PersonDraft, type SalienteDraft, type WeekendDraft } from './model';

function newDiscourse(): DiscourseDraft {
  return { tipo: 'PÚBLICO', titulo: '', orador: null, congregacion: null };
}

type SongField = 'cancionInicio' | 'cancionIntermedia' | 'cancionFin';
type TextField = 'hospitalidad';

// Meeting order: hospitalidad, canción inicial, presidente, canción, conductor, lector, canción final, oración.
const FIELDS: (
  | { kind: 'person'; key: WeekendPersonField; label: string }
  | { kind: 'song'; key: SongField; label: string }
  | { kind: 'text'; key: TextField; label: string; placeholder: string }
)[] = [
  { kind: 'text', key: 'hospitalidad', label: 'Hospitalidad', placeholder: 'Grupo …' },
  { kind: 'song', key: 'cancionInicio', label: 'Canción inicial' },
  { kind: 'person', key: 'presidente', label: 'Presidente' },
  { kind: 'song', key: 'cancionIntermedia', label: 'Canción (antes de La Atalaya)' },
  { kind: 'person', key: 'conductor', label: 'Conductor de La Atalaya' },
  { kind: 'person', key: 'lector', label: 'Lector' },
  { kind: 'song', key: 'cancionFin', label: 'Canción final' },
  { kind: 'person', key: 'oracionFinal', label: 'Oración final' },
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
  const salientes = value.discursantesSalientes;
  const setSaliente = (i: number, patch: Partial<SalienteDraft>) =>
    onChange({ ...value, discursantesSalientes: salientes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const pickSaliente = (i: number, v: PersonDraft) => setSaliente(i, { person_id: v.person_id, name: v.name });

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
        {FIELDS.map((f) =>
          f.kind === 'person' ? (
            <PersonPicker
              key={f.key}
              label={f.label}
              value={value[f.key]}
              onChange={(v) => onChange({ ...value, [f.key]: v })}
            />
          ) : (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-secondary text-ink-soft">{f.label}</span>
              <input
                className="field"
                value={value[f.key] ?? ''}
                placeholder={f.kind === 'text' ? f.placeholder : '2 · Jehová es mi Pastor'}
                onChange={(e) => onChange({ ...value, [f.key]: e.currentTarget.value })}
              />
            </label>
          ),
        )}
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
              <label className="flex flex-col gap-1">
                <span className="text-secondary text-ink-soft">Orador</span>
                <input
                  className="field"
                  value={disc.orador ?? ''}
                  onChange={(e) => setDisc({ orador: e.currentTarget.value })}
                />
              </label>
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

      <fieldset className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3">
        <legend className="px-1 text-secondary font-semibold text-ink-soft">
          Discursante saliente
        </legend>
        {salientes.length === 0 && (
          <p className="text-body text-ink-soft">Nadie sale a dar discurso esta semana.</p>
        )}
        {salientes.map((s, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <PersonPicker
                label={`Discursante saliente ${i + 1}`}
                value={s}
                onChange={(v) => pickSaliente(i, v)}
              />
              <label className="flex flex-col gap-1">
                <span className="text-secondary text-ink-soft">Congregación</span>
                <input
                  className="field"
                  aria-label={`Congregación del discursante saliente ${i + 1}`}
                  value={s.congregacion}
                  onChange={(e) => setSaliente(i, { congregacion: e.currentTarget.value })}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn-secondary"
              aria-label={`Quitar discursante saliente ${i + 1}`}
              onClick={() =>
                onChange({
                  ...value,
                  discursantesSalientes: salientes.filter((_, j) => j !== i),
                })
              }
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary self-start"
          onClick={() => onChange({ ...value, discursantesSalientes: [...salientes, NO_SALIENTE] })}
        >
          Agregar discursante saliente
        </button>
      </fieldset>
    </section>
  );
}
