/**
 * Lugares sub-tab: the cart places (name + colour). Places are the "where" of every turn,
 * so the colour is data (the member grid reuses it), not decoration.
 *
 * Writes go through the CAS cart mutations; editing is inline (one DOM tree, controlled
 * inputs) and a delete is a two-step confirm.
 */
import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  mutations,
  useDataMutation,
  type CartPlaceRow,
  type CartPlaceUpdate,
} from '@territorios/data';
import { ConflictBar, DeleteButton, Field, errorMessage, useWriteState } from './ui';

const DEFAULT_COLOR = '#4A9D8F';
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function LugaresTab({ places }: { places: CartPlaceRow[] }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);

  const createPlace = useDataMutation(mutations.createPlace);
  const updatePlace = useDataMutation(mutations.updatePlace);
  const deletePlace = useDataMutation(mutations.deletePlace);
  const write = useWriteState();

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      write.setError('Poné un nombre para el lugar.');
      return;
    }
    write.setError(null);
    try {
      await createPlace.mutateAsync({ name: trimmed, color: HEX.test(color) ? color : DEFAULT_COLOR });
      setName('');
      setColor(DEFAULT_COLOR);
    } catch (error) {
      write.setError(errorMessage(error));
    }
  }

  /** `version` is set when re-applying after a conflict ("Guardar lo mío"). */
  async function saveEdit(version?: number) {
    if (!editing) return;
    const patch: CartPlaceUpdate = {};
    const row = places.find((p) => p.id === editing.id);
    if (!row) {
      setEditing(null);
      return;
    }
    const trimmed = editing.name.trim();
    if (!trimmed) {
      write.setError('Poné un nombre para el lugar.');
      return;
    }
    if (trimmed !== row.name) patch.name = trimmed;
    if (HEX.test(editing.color) && editing.color.toLowerCase() !== row.color.toLowerCase()) {
      patch.color = editing.color;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    write.setError(null);
    try {
      await updatePlace.mutateAsync({ id: row.id, version: version ?? row.version, patch });
      setEditing(null);
    } catch (error) {
      if (!write.report(error, `El lugar ${row.name}`, (v) => void saveEdit(v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  async function remove(row: CartPlaceRow, version?: number) {
    write.setError(null);
    try {
      await deletePlace.mutateAsync({ id: row.id, version: version ?? row.version });
    } catch (error) {
      if (!write.report(error, `El lugar ${row.name}`, (v) => void remove(row, v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ConflictBar write={write} onUseTheirs={() => setEditing(null)} />

      <AddPlaceForm
        name={name}
        color={color}
        onName={setName}
        onColor={setColor}
        busy={createPlace.isPending}
        onSubmit={() => void add()}
      />

      {places.length === 0 ? (
        <p className="py-6 text-body text-ink-soft">
          Todavía no hay lugares. Agregá dónde se arma el carrito (por ejemplo, el salón).
        </p>
      ) : (
        <ul className="flex flex-col border-t border-line">
          {places.map((place) =>
            editing?.id === place.id ? (
              <li
                key={place.id}
                className="flex flex-col gap-3 border-b border-line py-3 lg:grid lg:grid-cols-[4rem_minmax(0,1fr)_auto] lg:items-center lg:gap-4"
              >
                <ColorInput
                  label="Color"
                  value={editing.color}
                  onChange={(value) => setEditing({ ...editing, color: value })}
                  hideLabel
                />
                <Field label="Nombre del lugar">
                  <input
                    className="field"
                    value={editing.name}
                    autoComplete="off"
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={updatePlace.isPending}
                    onClick={() => void saveEdit()}
                  >
                    {updatePlace.isPending ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </div>
              </li>
            ) : (
              <li
                key={place.id}
                className="flex flex-col gap-2 border-b border-line py-3 lg:grid lg:grid-cols-[4rem_minmax(0,1fr)_auto] lg:items-center lg:gap-4"
              >
                <span
                  aria-hidden
                  className="h-6 w-10 rounded-sm border border-line"
                  style={{ backgroundColor: place.color }}
                />
                <span className="min-w-0 text-body-strong font-semibold break-words">{place.name}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditing({ id: place.id, name: place.name, color: place.color })}
                  >
                    Editar
                  </button>
                  <DeleteButton
                    label="Eliminar"
                    busy={deletePlace.isPending}
                    onConfirm={() => void remove(place)}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function AddPlaceForm({
  name,
  color,
  onName,
  onColor,
  busy,
  onSubmit,
}: {
  name: string;
  color: string;
  onName: (value: string) => void;
  onColor: (value: string) => void;
  busy: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-3 lg:flex-row lg:items-end">
      <ColorInput label="Color" value={color} onChange={onColor} />
      <Field label="Nombre del lugar" className="flex-1">
        <input
          className="field"
          value={name}
          autoComplete="off"
          placeholder="Ej: Salón"
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
        />
      </Field>
      <button
        type="button"
        className="btn-primary inline-flex items-center justify-center gap-2"
        disabled={busy}
        onClick={onSubmit}
      >
        <Plus aria-hidden size={20} />
        {busy ? 'Agregando…' : 'Agregar lugar'}
      </button>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${hideLabel ? 'w-16' : 'w-24'}`}>
      <label htmlFor={id} className={`text-secondary text-ink-soft ${hideLabel ? 'sr-only' : ''}`}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        className="field h-touch w-full cursor-pointer p-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
