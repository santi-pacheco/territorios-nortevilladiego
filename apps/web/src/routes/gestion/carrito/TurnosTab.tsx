/**
 * Turnos sub-tab: the weekly slots (day, time window, place and group size) that the
 * scheduler fills. ISO day numbering (1 = Lunes … 7 = Domingo), unlike Salidas.
 *
 * The add/edit form lives in a `<dialog>` sheet on every width, so there is a single
 * form DOM tree and every input is controlled.
 */
import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  mutations,
  useDataMutation,
  type CartPlaceRow,
  type CartSlotRow,
  type CartSlotUpdate,
} from '@territorios/data';
import { CARRITO_DAY_NAMES } from '@territorios/core';
import { dayName, groupByDay, timeRange } from './model';
import { ConflictBar, DeleteButton, Field, Sheet, errorMessage, useWriteState } from './ui';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** `time` inputs speak HH:MM; Postgres prints HH:MM:SS. */
const toTimeValue = (value: string): string => value.slice(0, 5);

export function TurnosTab({
  slots,
  places,
}: {
  slots: CartSlotRow[];
  places: CartPlaceRow[];
}) {
  const [sheet, setSheet] = useState<{ slot: CartSlotRow | null } | null>(null);
  const deleteSlot = useDataMutation(mutations.deleteSlot);
  const write = useWriteState();

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const byDay = useMemo(() => groupByDay(slots), [slots]);

  async function remove(slot: CartSlotRow, version?: number) {
    write.setError(null);
    try {
      await deleteSlot.mutateAsync({ id: slot.id, version: version ?? slot.version });
    } catch (error) {
      if (!write.report(error, `El turno del ${dayName(slot.iso_dow)}`, (v) => void remove(slot, v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          disabled={places.length === 0}
          onClick={() => setSheet({ slot: null })}
        >
          <Plus aria-hidden size={20} />
          Nuevo turno
        </button>
      </div>

      <ConflictBar write={write} />

      {places.length === 0 ? (
        <p className="py-6 text-body text-ink-soft">
          Primero creá un lugar: cada turno ocurre en uno.
        </p>
      ) : slots.length === 0 ? (
        <p className="py-6 text-body text-ink-soft">
          Todavía no hay turnos. Agregá los días, horarios y tamaño de grupo del carrito.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {byDay.map((group) => (
            <section key={group.isoDow} aria-labelledby={`turnos-dia-${group.isoDow}`}>
              <h3 id={`turnos-dia-${group.isoDow}`} className="text-heading font-bold">
                {group.label}
              </h3>
              <ul className="mt-1 flex flex-col border-t border-line">
                {group.slots.map((slot) => {
                  const place = placeById.get(slot.place_id);
                  return (
                    <li
                      key={slot.id}
                      className="flex flex-col gap-2 border-b border-line py-3 lg:grid lg:grid-cols-[8rem_minmax(0,1fr)_5rem_minmax(0,1fr)_auto] lg:items-center lg:gap-4"
                    >
                      <span className="font-mono text-body">
                        {timeRange(slot.start_time, slot.end_time)}
                      </span>
                      <span className="flex min-w-0 items-center gap-2 text-body">
                        {place && (
                          <span
                            aria-hidden
                            className="h-3 w-3 shrink-0 rounded-full border border-line"
                            style={{ backgroundColor: place.color }}
                          />
                        )}
                        <span className="break-words">{place?.name ?? 'Lugar eliminado'}</span>
                      </span>
                      <span className="text-body">
                        <span className="text-secondary text-ink-soft lg:hidden">Grupo: </span>
                        {slot.group_size}
                      </span>
                      <span className="min-w-0 text-secondary text-ink-soft break-words">
                        {slot.display_label ?? '—'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setSheet({ slot })}
                        >
                          Editar
                        </button>
                        <DeleteButton
                          label="Eliminar"
                          busy={deleteSlot.isPending}
                          onConfirm={() => void remove(slot)}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {sheet && (
        <SlotSheet
          slot={sheet.slot}
          places={places}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function SlotSheet({
  slot,
  places,
  onClose,
}: {
  slot: CartSlotRow | null;
  places: CartPlaceRow[];
  onClose: () => void;
}) {
  const dowId = useId();
  const write = useWriteState();

  const [placeId, setPlaceId] = useState(slot?.place_id ?? places[0]?.id ?? '');
  const [isoDow, setIsoDow] = useState(slot?.iso_dow ?? 2);
  const [startTime, setStartTime] = useState(slot ? toTimeValue(slot.start_time) : '08:30');
  const [endTime, setEndTime] = useState(slot ? toTimeValue(slot.end_time) : '10:30');
  const [groupSize, setGroupSize] = useState(slot?.group_size ?? 3);
  const [label, setLabel] = useState(slot?.display_label ?? '');

  const createSlot = useDataMutation(mutations.createSlot);
  const updateSlot = useDataMutation(mutations.updateSlot);
  const busy = createSlot.isPending || updateSlot.isPending;

  /** `version` is set when re-applying after a conflict ("Guardar lo mío"). */
  async function save(version?: number) {
    if (!placeId) {
      write.setError('Elegí un lugar.');
      return;
    }
    if (!startTime || !endTime || endTime <= startTime) {
      write.setError('La hora de fin tiene que ser después de la de inicio.');
      return;
    }
    const displayLabel = label.trim();
    write.setError(null);
    try {
      if (!slot) {
        await createSlot.mutateAsync({
          place_id: placeId,
          iso_dow: isoDow,
          start_time: startTime,
          end_time: endTime,
          group_size: groupSize,
          display_label: displayLabel || null,
        });
      } else {
        const patch: CartSlotUpdate = {};
        if (placeId !== slot.place_id) patch.place_id = placeId;
        if (isoDow !== slot.iso_dow) patch.iso_dow = isoDow;
        if (startTime !== toTimeValue(slot.start_time)) patch.start_time = startTime;
        if (endTime !== toTimeValue(slot.end_time)) patch.end_time = endTime;
        if (groupSize !== slot.group_size) patch.group_size = groupSize;
        if (displayLabel !== (slot.display_label ?? '')) patch.display_label = displayLabel || null;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await updateSlot.mutateAsync({ id: slot.id, version: version ?? slot.version, patch });
      }
      onClose();
    } catch (error) {
      if (!write.report(error, 'El turno', (v) => void save(v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  return (
    <Sheet title={slot ? 'Editar turno' : 'Nuevo turno'} onClose={onClose}>
      <ConflictBar write={write} onUseTheirs={onClose} />

      <Field label="Lugar">
        <select className="field" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Día">
        <select
          id={dowId}
          className="field"
          value={isoDow}
          onChange={(e) => setIsoDow(Number(e.target.value))}
        >
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {CARRITO_DAY_NAMES[day] ?? `Día ${day}`}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label="Desde" className="flex-1">
          <input
            type="time"
            className="field font-mono"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </Field>
        <Field label="Hasta" className="flex-1">
          <input
            type="time"
            className="field font-mono"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </Field>
        <Field label="Tamaño del grupo" className="sm:w-40">
          <input
            type="number"
            className="field font-mono"
            min={1}
            max={12}
            value={groupSize}
            onChange={(e) =>
              setGroupSize(Math.max(1, Math.min(12, Number(e.target.value) || 1)))
            }
          />
        </Field>
      </div>

      <Field label="Etiqueta en el cronograma (opcional)">
        <input
          className="field"
          value={label}
          autoComplete="off"
          placeholder="Ej: Salón, 8:30"
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Sheet>
  );
}
