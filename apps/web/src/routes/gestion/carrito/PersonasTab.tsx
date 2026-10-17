/**
 * Personas sub-tab: the editor-only roster (name, gender, availability, symmetric
 * pairs and target appearances). Writes use the CAS people mutations; a conflict
 * shows the inline "Alguien cambió esto" bar instead of clobbering.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { inferGender, type Gender } from '@territorios/core';
import {
  isConflictError,
  qk,
  useDataMutation,
  mutations,
  type CartPlaceRow,
  type CartSlotRow,
  type PeopleRoster,
  type PersonRow,
} from '@territorios/data';
import { buildRoster, dayName, groupByDay, timeRange } from './model';
import { ConflictBar, DeleteButton, Field, Sheet, errorMessage, useWriteState } from './ui';

const GENDER_LABEL: Record<Gender, string> = { M: 'Varón', F: 'Mujer' };

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function PersonasTab({
  roster,
  slots,
  places,
}: {
  roster: PeopleRoster;
  slots: CartSlotRow[];
  places: CartPlaceRow[];
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [sheet, setSheet] = useState<{ person: PersonRow | null } | null>(null);
  const qc = useQueryClient();

  const people = useMemo(
    () => buildRoster(roster.people, roster.availability, roster.pairs),
    [roster],
  );
  const nameById = useMemo(() => new Map(roster.people.map((p) => [p.id, p.name])), [roster.people]);
  const slotById = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

  // The carrito works with in_carrito people; the rest of the directory is one toggle away.
  const inCarrito = useMemo(() => new Set(roster.people.filter((p) => p.in_carrito).map((p) => p.id)), [roster.people]);
  const outside = roster.people.length - inCarrito.size;
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    const pool = showAll ? people : people.filter((p) => inCarrito.has(p.id));
    if (!q) return pool;
    return pool.filter((p) => normalize(p.name).includes(q));
  }, [people, query, showAll, inCarrito]);

  const deletePerson = useDataMutation(mutations.deletePerson);
  const write = useWriteState();

  function useTheirChanges() {
    void qc.invalidateQueries({ queryKey: qk.people });
  }

  async function remove(person: PersonRow, version?: number) {
    write.setError(null);
    try {
      await deletePerson.mutateAsync({ id: person.id, version: version ?? person.version });
    } catch (error) {
      if (!write.report(error, person.name, (v) => void remove(person, v))) {
        write.setError(errorMessage(error));
      }
    }
  }

  function availabilityText(personId: string): string {
    const p = people.find((x) => x.id === personId);
    const ids = p?.availableSlotIds ?? [];
    if (ids.length === 0) return 'Ningún turno';
    const labels = ids
      .map((id) => slotById.get(id))
      .filter((s): s is CartSlotRow => Boolean(s))
      .map((s) => `${dayName(s.iso_dow)} ${timeRange(s.start_time, s.end_time)}`);
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} y ${labels.length - 2} más`;
  }

  function pairsText(personId: string): string {
    const p = people.find((x) => x.id === personId);
    const ids = p?.mustBeWithIds ?? [];
    if (ids.length === 0) return '—';
    return ids.map((id) => nameById.get(id) ?? id).join(', ');
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-secondary text-ink-soft">
        Las personas se administran en{' '}
        <Link to="/gestion/personas" className="font-semibold text-ink underline">
          Gestión ▸ Personas
        </Link>
        . Acá van los datos del carrito: turnos, con quién va y participaciones.
      </p>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Field label="Buscar por nombre" className="lg:max-w-xs">
          <input
            type="search"
            className="field"
            value={query}
            placeholder="Ej: Pérez"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2 self-start"
          onClick={() => setSheet({ person: null })}
        >
          <Plus aria-hidden size={20} />
          Nueva persona
        </button>
      </div>

      {outside > 0 && (
        <label className="flex min-h-touch items-center gap-2 self-start text-body">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
          />
          Mostrar también a quienes no están en el carrito ({outside})
        </label>
      )}

      <ConflictBar write={write} onUseTheirs={useTheirChanges} />

      {people.length === 0 ? (
        <p className="py-6 text-body text-ink-soft">
          Todavía no hay personas. Agregá la primera para poder generar el cronograma.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-body text-ink-soft">
          {query.trim()
            ? `Ninguna persona coincide con “${query}”.`
            : 'Nadie está marcado “En carrito”. Marcalo en Gestión ▸ Personas.'}
        </p>
      ) : (
        <ul className="flex flex-col border-t border-line">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 border-b border-line py-3 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_4rem_auto] lg:items-center lg:gap-4"
            >
              <div className="min-w-0">
                <span className="text-body-strong font-semibold break-words">{p.name}</span>
                <span className="ml-2 text-secondary text-ink-soft">{GENDER_LABEL[p.gender]}</span>
                {!inCarrito.has(p.id) && (
                  <span className="ml-2 text-secondary text-ink-soft">· Fuera del carrito</span>
                )}
              </div>
              <div className="min-w-0 text-secondary text-ink-soft break-words">
                <span className="lg:hidden">Turnos: </span>
                {availabilityText(p.id)}
              </div>
              <div className="min-w-0 text-secondary text-ink-soft break-words">
                <span className="lg:hidden">Va con: </span>
                {pairsText(p.id)}
              </div>
              <div className="text-body">
                <span className="lg:hidden text-secondary text-ink-soft">Objetivo: </span>
                {p.targetAppearances === 0 ? (
                  'Libre'
                ) : (
                  <span className="font-mono">{p.targetAppearances}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSheet({ person: rowOf(roster, p.id) })}
                >
                  Editar
                </button>
                <DeleteButton onConfirm={() => void remove(rowOf(roster, p.id))} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {sheet && (
        <PersonSheet
          person={sheet.person}
          roster={roster}
          slots={slots}
          places={places}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function availabilityOf(roster: PeopleRoster, personId: string): string[] {
  return roster.availability.filter((a) => a.person_id === personId).map((a) => a.slot_id);
}

/** Pairs are symmetric: a row (a, b) ties both people, whichever column they are in. */
function pairsOf(roster: PeopleRoster, personId: string): string[] {
  return roster.pairs
    .filter((p) => p.person_a === personId || p.person_b === personId)
    .map((p) => (p.person_a === personId ? p.person_b : p.person_a));
}

/** The raw row for a person id (delete needs the row version). */
function rowOf(roster: PeopleRoster, id: string): PersonRow {
  const row = roster.people.find((p) => p.id === id);
  if (!row) throw new Error('Persona no encontrada');
  return row;
}

function PersonSheet({
  person,
  roster,
  slots,
  places,
  onClose,
}: {
  person: PersonRow | null;
  roster: PeopleRoster;
  slots: CartSlotRow[];
  places: CartPlaceRow[];
  onClose: () => void;
}) {
  const nameId = useId();
  const genderName = useId();
  const qc = useQueryClient();
  const write = useWriteState();

  // The form starts from the roster as it was when the sheet opened; saving diffs against the
  // live roster (a refetch after a conflict must be visible to "Guardar lo mío").
  const live = useRef(roster);
  useEffect(() => {
    live.current = roster;
  }, [roster]);

  const [name, setName] = useState(person?.name ?? '');
  const [gender, setGender] = useState<Gender>(person?.gender ?? 'F');
  const [genderTouched, setGenderTouched] = useState(Boolean(person));
  const [available, setAvailable] = useState<string[]>(() =>
    person ? availabilityOf(roster, person.id) : [],
  );
  const [pairs, setPairs] = useState<string[]>(() => (person ? pairsOf(roster, person.id) : []));
  const [target, setTarget] = useState(person ? person.target_appearances : 2);

  const createPerson = useDataMutation(mutations.createPerson);
  const updatePerson = useDataMutation(mutations.updatePerson);
  const addAvailability = useDataMutation(mutations.addAvailability);
  const removeAvailability = useDataMutation(mutations.removeAvailability);
  const addPair = useDataMutation(mutations.addPair);
  const removePair = useDataMutation(mutations.removePair);

  const busy =
    createPerson.isPending ||
    updatePerson.isPending ||
    addAvailability.isPending ||
    removeAvailability.isPending ||
    addPair.isPending ||
    removePair.isPending;

  const dayGroups = useMemo(() => groupByDay(slots), [slots]);
  // Partners come from the carrito, plus anyone already paired (so an old pair can be undone).
  const otherPeople = useMemo(() => {
    const paired = new Set(person ? pairsOf(roster, person.id) : []);
    return roster.people.filter((p) => p.id !== person?.id && (p.in_carrito || paired.has(p.id)));
  }, [roster, person]);

  function onNameChange(value: string) {
    setName(value);
    if (!genderTouched) {
      const inferred = inferGender(value);
      if (inferred) setGender(inferred);
    }
  }

  function toggle<T>(list: T[], value: T, setter: (next: T[]) => void) {
    setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  }

  async function addAvailabilityIgnoringDuplicate(personId: string, slotId: string) {
    try {
      await addAvailability.mutateAsync({ person_id: personId, slot_id: slotId });
    } catch (error) {
      // 23505 = the availability row already exists (e.g. a retried save). Treat as done.
      if (error instanceof Error && 'code' in error && error.code === '23505') return;
      throw error;
    }
  }

  async function addPairIgnoringDuplicate(a: string, b: string) {
    try {
      await addPair.mutateAsync({ person_a: a, person_b: b });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') return;
      throw error;
    }
  }

  /**
   * Create or update the person, then reconcile availability and pairs with the live roster.
   * Re-running is safe: steps that already landed are skipped. `personVersion` is the server
   * version of the person row when re-applying after a conflict on that row.
   */
  async function save(personVersion?: number) {
    write.setError(null);
    const values = { name: name.trim(), gender, target };
    if (!values.name) {
      write.setError('Poné un nombre.');
      return;
    }
    try {
      let id: string;
      if (!person) {
        const created = await createPerson.mutateAsync({
          name: values.name,
          gender: values.gender,
          target_appearances: values.target,
        });
        id = created.id;
      } else {
        id = person.id;
        const row = live.current.people.find((p) => p.id === id);
        if (!row) {
          write.setError(`${person.name} ya no existe: lo borró otra persona.`);
          return;
        }
        const unchanged =
          row.name === values.name &&
          row.gender === values.gender &&
          row.target_appearances === values.target;
        if (!unchanged) {
          await updatePerson.mutateAsync({
            id,
            version: personVersion ?? person.version,
            patch: { name: values.name, gender: values.gender, target_appearances: values.target },
          });
        }
      }

      const roster = live.current;
      const haveSlots = new Set(availabilityOf(roster, id));
      const wantSlots = new Set(available);
      for (const slotId of wantSlots) {
        if (!haveSlots.has(slotId)) await addAvailabilityIgnoringDuplicate(id, slotId);
      }
      for (const slotId of haveSlots) {
        if (wantSlots.has(slotId)) continue;
        const row = roster.availability.find((a) => a.person_id === id && a.slot_id === slotId);
        if (row) {
          await removeAvailability.mutateAsync({ person_id: id, slot_id: slotId, version: row.version });
        }
      }

      const havePairs = new Set(pairsOf(roster, id));
      const wantPairs = new Set(pairs);
      for (const otherId of wantPairs) {
        if (!havePairs.has(otherId)) await addPairIgnoringDuplicate(id, otherId);
      }
      for (const otherId of havePairs) {
        if (wantPairs.has(otherId)) continue;
        const row = roster.pairs.find(
          (p) =>
            (p.person_a === id && p.person_b === otherId) ||
            (p.person_a === otherId && p.person_b === id),
        );
        if (row) {
          await removePair.mutateAsync({ person_a: row.person_a, person_b: row.person_b, version: row.version });
        }
      }
      onClose();
    } catch (error) {
      const onPerson = isConflictError(error) && error.table === 'people';
      // Availability and pair rows carry their own versions: re-running the diff against the
      // refetched roster is enough for those.
      const retry = (v: number) => void save(onPerson ? v : undefined);
      if (!write.report(error, person ? person.name : 'La persona', retry)) {
        write.setError(errorMessage(error));
      }
      if (isConflictError(error)) {
        void qc.invalidateQueries({ queryKey: qk.people });
      }
    }
  }

  function useTheirChanges() {
    void qc.invalidateQueries({ queryKey: qk.people });
    onClose();
  }

  return (
    <Sheet title={person ? 'Editar persona' : 'Nueva persona'} onClose={onClose}>
      <ConflictBar write={write} onUseTheirs={useTheirChanges} />

      <Field label="Nombre completo">
        <input
          id={nameId}
          className="field"
          value={name}
          autoComplete="off"
          placeholder="Ej: Pérez, Ana"
          onChange={(e) => onNameChange(e.target.value)}
        />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-secondary text-ink-soft">Género</legend>
        <div className="flex flex-wrap gap-4">
          {(['F', 'M'] as const).map((value) => (
            <label key={value} className="flex min-h-touch items-center gap-2 text-body">
              <input
                type="radio"
                name={genderName}
                checked={gender === value}
                onChange={() => {
                  setGender(value);
                  setGenderTouched(true);
                }}
              />
              {GENDER_LABEL[value]}
            </label>
          ))}
        </div>
        <p className="text-secondary text-ink-soft">
          Lo sugerimos por el nombre; podés cambiarlo.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-secondary text-ink-soft">Turnos disponibles</legend>
        {dayGroups.length === 0 ? (
          <p className="text-body text-ink-soft">Todavía no hay turnos configurados.</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-sm border border-line p-3">
            {dayGroups.map((group) => (
              <div key={group.isoDow}>
                <p className="text-body-strong font-semibold">{group.label}</p>
                <div className="mt-1 flex flex-col">
                  {group.slots.map((slot) => (
                    <label key={slot.id} className="flex min-h-touch items-center gap-2 text-body">
                      <input
                        type="checkbox"
                        checked={available.includes(slot.id)}
                        onChange={() => toggle(available, slot.id, setAvailable)}
                      />
                      <span className="font-mono">{timeRange(slot.start_time, slot.end_time)}</span>
                      <span className="text-ink-soft">
                        {places.find((p) => p.id === slot.place_id)?.name ?? ''}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-secondary text-ink-soft">Va siempre con…</legend>
        {otherPeople.length === 0 ? (
          <p className="text-body text-ink-soft">No hay otras personas todavía.</p>
        ) : (
          <div className="flex max-h-56 flex-col overflow-y-auto rounded-sm border border-line p-3">
            {otherPeople.map((other) => (
              <label key={other.id} className="flex min-h-touch items-center gap-2 text-body">
                <input
                  type="checkbox"
                  checked={pairs.includes(other.id)}
                  onChange={() => toggle(pairs, other.id, setPairs)}
                />
                <span className="break-words">{other.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="text-secondary text-ink-soft">
          Es mutuo: si la marcás acá, también figura en la ficha de esa persona.
        </p>
      </fieldset>

      <Field label="Participaciones objetivo (0 = sin límite)">
        <input
          type="number"
          className="field w-28"
          min={0}
          max={999}
          value={target}
          onChange={(e) => setTarget(Math.max(0, Math.min(999, Number(e.target.value) || 0)))}
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
