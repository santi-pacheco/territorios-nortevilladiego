/**
 * One weekend meeting as a controlled form: the fields the printed programme carries
 * (presidente, discurso, conductor, lector, oración final, asamblea). The discourse is
 * optional — the toggle adds a `WeekendDiscourse`, matching the core type `discurso: ... | null`.
 *
 * Fields the editor does not show (canciones, `discurso.saliente`) stay in the value and are
 * round-tripped untouched on save.
 */
import { useId } from 'react';
import type { WeekendDiscourse, WeekendMeeting } from '@territorios/core';
import { DISCOURSE_TIPOS } from './model';

function newDiscourse(): WeekendDiscourse {
  return { tipo: 'PÚBLICO', titulo: '', orador: null, congregacion: null, saliente: null };
}

type TextField = 'asamblea' | 'presidente' | 'conductor' | 'lector' | 'oracionFinal';

export function WeekendEditor({
  value,
  onChange,
}: {
  value: WeekendMeeting;
  onChange: (meeting: WeekendMeeting) => void;
}) {
  const id = useId();
  const disc = value.discurso;

  const text = (key: TextField) => value[key] ?? '';
  const setText = (key: TextField, v: string) => onChange({ ...value, [key]: v });
  const setDisc = (patch: Partial<WeekendDiscourse>) =>
    onChange({ ...value, discurso: { ...(disc ?? newDiscourse()), ...patch } });

  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-4">
      <h4 id={`${id}-h`} className="text-heading font-bold">
        Reunión del fin de semana
      </h4>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Presidente</span>
          <input
            className="field"
            value={text('presidente')}
            onChange={(e) => setText('presidente', e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Conductor de La Atalaya</span>
          <input
            className="field"
            value={text('conductor')}
            onChange={(e) => setText('conductor', e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Lector</span>
          <input
            className="field"
            value={text('lector')}
            onChange={(e) => setText('lector', e.currentTarget.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Oración final</span>
          <input
            className="field"
            value={text('oracionFinal')}
            onChange={(e) => setText('oracionFinal', e.currentTarget.value)}
          />
        </label>
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
    </section>
  );
}
