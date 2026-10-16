/**
 * Generar sub-tab: run the scheduler in a worker, review and tweak the preview grid, then
 * publish it as `cart_schedules` + `cart_assignments`.
 *
 * Notes are preserved across regenerations (keyed by Monday of the week + slot id) and the
 * preview is editable by hand: click a name to swap it, "Agregar" to append, or type a note.
 */
import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Upload, X } from 'lucide-react';
import type { ScheduleEntry } from '@territorios/core';
import {
  mutations,
  useDataMutation,
  type CartBoard,
  type CartScheduleUpdate,
  type PeopleRoster,
} from '@territorios/data';
import {
  buildRoster,
  dayName,
  entryKey,
  findEntry,
  sortSlots,
  timeRange,
  toBlackouts,
  toCorePlaces,
  toCoreSlots,
  weekRefsInRange,
  type RosterPerson,
} from './model';
import { applyNotes, buildScheduleInsert, collectNotes, planPublish } from './publish';
import { runScheduler } from './scheduler';
import { ConflictBar, EmptyState, Field, Sheet, errorMessage, useWriteState } from './ui';

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, '0')}` };
}

function defaultName(): string {
  const now = new Date();
  return `Carrito de ${MONTHS[now.getMonth()] ?? ''} de ${now.getFullYear()}`;
}

type PublishTarget = 'replace' | 'new';

interface PickerTarget {
  weekDate: string;
  slotId: string;
  /** -1 = append a new person; otherwise replace the person at that index. */
  index: number;
}

export function GenerarTab({
  roster,
  board,
}: {
  roster: PeopleRoster;
  board: CartBoard;
}) {
  const range = useMemo(() => currentMonthRange(), []);
  const [name, setName] = useState(board.schedule?.name ?? defaultName());
  const [startDate, setStartDate] = useState(board.schedule?.start_date ?? range.start);
  const [endDate, setEndDate] = useState(board.schedule?.end_date ?? range.end);
  const [entries, setEntries] = useState<ScheduleEntry[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: number; failed: string[] } | null>(null);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [target, setTarget] = useState<PublishTarget>(board.schedule ? 'replace' : 'new');
  const write = useWriteState();
  const targetName = useId();

  const createSchedule = useDataMutation(mutations.createSchedule);
  const updateSchedule = useDataMutation(mutations.updateSchedule);
  const createAssignment = useDataMutation(mutations.createAssignment);
  const updateAssignment = useDataMutation(mutations.updateAssignment);
  const deleteAssignment = useDataMutation(mutations.deleteAssignment);
  const replacing = target === 'replace' ? board.schedule : null;

  const people = useMemo<RosterPerson[]>(
    () => buildRoster(roster.people, roster.availability, roster.pairs),
    [roster],
  );
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const placeName = useMemo(() => {
    const map = new Map(board.places.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? id;
  }, [board.places]);

  const orderedSlots = useMemo(() => sortSlots(board.slots), [board.slots]);
  const weeks = useMemo(() => weekRefsInRange(startDate, endDate), [startDate, endDate]);
  const weekLabelByDate = useMemo(() => {
    const map = new Map(weeks.map((w) => [w.weekDate, w.weekLabel]));
    return (date: string) => map.get(date) ?? date;
  }, [weeks]);

  const entryByKey = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    for (const e of entries ?? []) map.set(entryKey(e.weekDate, e.slotId), e);
    return map;
  }, [entries]);
  const getEntry = (weekDate: string, slotId: string) =>
    entryByKey.get(entryKey(weekDate, slotId));

  const publishable = useMemo(
    () => (entries ?? []).filter((e) => e.personIds.length > 0 || (e.note?.trim() ?? '') !== ''),
    [entries],
  );

  async function generate() {
    if (!startDate || !endDate) {
      write.setError('Elegí el rango de fechas.');
      return;
    }
    if (endDate < startDate) {
      write.setError('La fecha de fin tiene que ser después de la de inicio.');
      return;
    }
    if (people.length === 0) {
      write.setError('Agregá personas antes de generar el cronograma.');
      return;
    }
    if (board.slots.length === 0) {
      write.setError('Agregá turnos antes de generar el cronograma.');
      return;
    }
    setGenerating(true);
    write.setError(null);
    setOutcome(null);
    try {
      const result = await runScheduler({
        people,
        slots: toCoreSlots(board.slots),
        places: toCorePlaces(board.places),
        blackouts: toBlackouts(board.blackouts),
        name: name.trim() || defaultName(),
        startDate,
        endDate,
      });
      // Keep published notes and anything typed in the current preview, keyed by week + slot.
      const notes = collectNotes(board.assignments);
      for (const e of entries ?? []) {
        if (e.note) notes.set(entryKey(e.weekDate, e.slotId), e.note);
      }
      setEntries(
        applyNotes(result.entries, notes, {
          startDate,
          endDate,
          slotIds: new Set(board.slots.map((s) => s.id)),
        }),
      );
      setWarnings(result.warnings);
    } catch (error) {
      write.setError(error instanceof Error ? error.message : 'No se pudo generar el cronograma.');
    } finally {
      setGenerating(false);
    }
  }

  function setPersonAt(weekDate: string, slotId: string, index: number, personId: string | null) {
    setEntries((prev) => {
      const list = (prev ?? []).map((e) => ({ ...e, personIds: [...e.personIds] }));
      let target = findEntry(list, weekDate, slotId);
      if (!target) {
        target = { weekDate, weekLabel: weekLabelByDate(weekDate), slotId, personIds: [] };
        list.push(target);
      }
      if (index >= 0 && index < target.personIds.length) {
        if (personId === null) target.personIds.splice(index, 1);
        else target.personIds[index] = personId;
      } else if (personId !== null) {
        target.personIds.push(personId);
      }
      target.personIds = target.personIds.filter((id, i, arr) => arr.indexOf(id) === i);
      return prune(list);
    });
    setPicker(null);
  }

  function setNote(weekDate: string, slotId: string, note: string) {
    setEntries((prev) => {
      const list = (prev ?? []).map((e) => ({ ...e }));
      const target = findEntry(list, weekDate, slotId);
      const trimmed = note.trim();
      if (target) {
        if (trimmed) target.note = trimmed;
        else delete target.note;
      } else if (trimmed) {
        list.push({ weekDate, weekLabel: weekLabelByDate(weekDate), slotId, personIds: [], note: trimmed });
      }
      return prune(list);
    });
  }

  /**
   * Publish the preview. Replacing updates the loaded schedule in place (only the cells that
   * changed); otherwise a new schedule is created. `scheduleVersion` is the server version
   * when re-applying after a conflict on the schedule row.
   */
  async function publish(scheduleVersion?: number) {
    if (!entries) return;
    if (!replacing && publishable.length === 0) {
      write.setError('No hay turnos con personas para publicar.');
      return;
    }
    // Snapshot before the first await: the board refetches between the writes below.
    const existing = replacing ? [...board.assignments] : [];
    const preview = [...publishable];
    setPublishing(true);
    write.setError(null);
    setOutcome(null);
    try {
      let scheduleId: string;
      if (replacing) {
        const insert = buildScheduleInsert(name, startDate, endDate);
        const patch: CartScheduleUpdate = {};
        if (insert.name !== undefined && insert.name !== replacing.name) patch.name = insert.name;
        if (startDate !== replacing.start_date || endDate !== replacing.end_date) {
          patch.start_date = startDate;
          patch.end_date = endDate;
        }
        if (Object.keys(patch).length > 0) {
          await updateSchedule.mutateAsync({
            id: replacing.id,
            version: scheduleVersion ?? replacing.version,
            patch,
          });
        }
        scheduleId = replacing.id;
      } else {
        const created = await createSchedule.mutateAsync(
          buildScheduleInsert(name, startDate, endDate),
        );
        scheduleId = created.id;
      }

      const plan = planPublish(scheduleId, preview, existing);
      const failed: string[] = [];
      let ok = 0;
      const labelFor = (id: string) => {
        const row = existing.find((a) => a.id === id);
        return cellLabel(row?.week_date ?? '', row?.slot_id ?? '', placeName, board);
      };
      for (const update of plan.updates) {
        try {
          await updateAssignment.mutateAsync(update);
          ok++;
        } catch {
          failed.push(labelFor(update.id));
        }
      }
      for (const row of plan.creates) {
        try {
          await createAssignment.mutateAsync(row);
          ok++;
        } catch {
          failed.push(cellLabel(row.week_date, row.slot_id, placeName, board));
        }
      }
      for (const del of plan.deletes) {
        try {
          await deleteAssignment.mutateAsync(del);
          ok++;
        } catch {
          failed.push(labelFor(del.id));
        }
      }
      setOutcome({ ok, failed });
    } catch (error) {
      if (!write.report(error, 'El cronograma', (v) => void publish(v))) {
        write.setError(errorMessage(error));
      }
    } finally {
      setPublishing(false);
    }
  }

  const pickerSlot = picker ? board.slots.find((s) => s.id === picker.slotId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-sm border border-line bg-surface p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Título" className="flex-1">
            <input
              className="field"
              value={name}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Desde" className="sm:w-44">
            <input
              type="date"
              className="field font-mono"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Hasta" className="sm:w-44">
            <input
              type="date"
              className="field font-mono"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="btn-primary"
            disabled={generating}
            onClick={() => void generate()}
          >
            {generating ? 'Generando…' : 'Generar'}
          </button>
        </div>
        <p className="text-secondary text-ink-soft">
          El generador no cambia nada hasta que publiques. Podés generar de nuevo sin perder las
          notas.
        </p>
      </div>

      <ConflictBar write={write} />

      {warnings.length > 0 && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-3"
        >
          <p className="flex items-center gap-2 text-body-strong font-semibold">
            <AlertTriangle aria-hidden size={20} className="text-warn" />
            Para revisar ({warnings.length})
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-secondary text-ink-soft">
            {warnings.map((warning) => (
              <li key={warning} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {entries === null ? (
        <EmptyState
          title="Todavía no generaste el cronograma"
          body="Elegí el título y el rango de fechas, y tocá Generar. Vas a poder revisar y corregir el resultado antes de publicarlo."
        />
      ) : orderedSlots.length === 0 ? (
        <EmptyState
          title="No hay turnos"
          body="Creá turnos en la pestaña Turnos para poder armar el cronograma."
        />
      ) : (
        <section aria-labelledby="carrito-preview-h" className="flex flex-col gap-5">
          <h2 id="carrito-preview-h" className="text-title font-bold">
            Vista previa
          </h2>

          <div className="flex flex-col gap-5">
            {weeks.map((week) => (
              <div key={week.weekDate} className="flex flex-col gap-2">
                <h3 className="text-heading font-bold">Semana del {week.weekLabel}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {orderedSlots.map((slot) => (
                    <Cell
                      key={slot.id}
                      label={`${dayName(slot.iso_dow)} ${timeRange(slot.start_time, slot.end_time)}, ${placeName(slot.place_id)}`}
                      max={slot.group_size}
                      entry={getEntry(week.weekDate, slot.id)}
                      personById={personById}
                      onPick={(index) => setPicker({ weekDate: week.weekDate, slotId: slot.id, index })}
                      onNote={(note) => setNote(week.weekDate, slot.id, note)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {board.schedule && (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-secondary text-ink-soft">Al publicar</legend>
              <label className="flex min-h-touch items-center gap-2 text-body">
                <input
                  type="radio"
                  name={targetName}
                  checked={target === 'replace'}
                  onChange={() => setTarget('replace')}
                />
                <span className="min-w-0 break-words">
                  Reemplazar «{board.schedule.name}» (se mantienen las notas)
                </span>
              </label>
              <label className="flex min-h-touch items-center gap-2 text-body">
                <input
                  type="radio"
                  name={targetName}
                  checked={target === 'new'}
                  onChange={() => setTarget('new')}
                />
                Crear un cronograma nuevo
              </label>
            </fieldset>
          )}

          <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              disabled={publishing || (!replacing && publishable.length === 0)}
              onClick={() => void publish()}
            >
              <Upload aria-hidden size={20} />
              {publishing
                ? 'Publicando…'
                : publishable.length === 1
                  ? 'Publicar 1 turno'
                  : `Publicar ${publishable.length} turnos`}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={publishing}
              onClick={() => {
                setEntries(null);
                setWarnings([]);
                setOutcome(null);
              }}
            >
              Descartar
            </button>
          </div>
        </section>
      )}

      {outcome && (
        <div role="status" className="flex flex-col gap-1">
          {outcome.ok === 0 && outcome.failed.length === 0 && (
            <p className="text-body font-semibold text-ok">Ya estaba publicado así; no hubo cambios.</p>
          )}
          {outcome.ok > 0 && (
            <p className="text-body font-semibold text-ok">
              {outcome.ok === 1 ? 'Publicamos 1 cambio.' : `Publicamos ${outcome.ok} cambios.`}
            </p>
          )}
          {outcome.failed.map((label) => (
            <p key={label} className="text-body text-danger">
              {label}
            </p>
          ))}
        </div>
      )}

      {picker && pickerSlot && (
        <PersonPicker
          people={people}
          slotId={picker.slotId}
          canRemove={picker.index >= 0}
          onChoose={(personId) => setPersonAt(picker.weekDate, picker.slotId, picker.index, personId)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** Drop entries that carry neither people nor a note (they would publish nothing). */
function prune(list: ScheduleEntry[]): ScheduleEntry[] {
  return list.filter((e) => e.personIds.length > 0 || (e.note?.trim() ?? '') !== '');
}

function cellLabel(
  weekDate: string,
  slotId: string,
  placeName: (id: string) => string,
  board: CartBoard,
): string {
  const slot = board.slots.find((s) => s.id === slotId);
  const where = slot
    ? `${dayName(slot.iso_dow)} ${timeRange(slot.start_time, slot.end_time)}, ${placeName(slot.place_id)}`
    : 'un turno';
  return `Semana del ${weekDate}: no se pudo guardar ${where}. Alguien lo cambió o no hay conexión; generá y publicá de nuevo.`;
}

function Cell({
  label,
  max,
  entry,
  personById,
  onPick,
  onNote,
}: {
  label: string;
  max: number;
  entry: ScheduleEntry | undefined;
  personById: Map<string, RosterPerson>;
  onPick: (index: number) => void;
  onNote: (note: string) => void;
}) {
  const noteId = useId();
  const persons = entry?.personIds ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-3">
      <p className="text-secondary font-semibold text-ink">{label}</p>
      <ul className="flex flex-col">
        {persons.map((id, index) => (
          <li key={`${id}-${index}`}>
            <button
              type="button"
              className="flex min-h-touch w-full items-center text-left text-body underline-offset-2 hover:underline"
              onClick={() => onPick(index)}
            >
              {personById.get(id)?.name ?? id}
            </button>
          </li>
        ))}
        {persons.length === 0 && (
          <li className="flex min-h-touch items-center text-secondary text-ink-soft">
            Sin asignar
          </li>
        )}
      </ul>
      {persons.length < max && (
        <button
          type="button"
          className="inline-flex min-h-touch w-fit items-center gap-1 text-secondary font-semibold text-ink-soft hover:text-ink"
          onClick={() => onPick(-1)}
        >
          <Plus aria-hidden size={16} />
          Agregar
        </button>
      )}
      <label htmlFor={noteId} className="sr-only">
        Nota del turno
      </label>
      <input
        id={noteId}
        className="field text-secondary"
        value={entry?.note ?? ''}
        placeholder="Nota…"
        onChange={(e) => onNote(e.target.value)}
      />
    </div>
  );
}

function PersonPicker({
  people,
  slotId,
  canRemove,
  onChoose,
  onClose,
}: {
  people: RosterPerson[];
  slotId: string;
  canRemove: boolean;
  onChoose: (personId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered = normalized
      ? people.filter((p) => p.name.toLowerCase().includes(normalized))
      : people;
    return [...filtered].sort((a, b) => {
      const aAvail = a.availableSlotIds.includes(slotId) ? 0 : 1;
      const bAvail = b.availableSlotIds.includes(slotId) ? 0 : 1;
      return aAvail !== bAvail ? aAvail - bAvail : a.name.localeCompare(b.name);
    });
  }, [people, normalized, slotId]);

  return (
    <Sheet title="Elegir persona" onClose={onClose}>
      <Field label="Buscar por nombre">
        <input
          type="search"
          className="field"
          value={query}
          autoComplete="off"
          placeholder="Ej: Gómez"
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>

      <ul className="flex max-h-80 flex-col overflow-y-auto border-t border-line">
        {rows.map((person) => {
          const available = person.availableSlotIds.includes(slotId);
          return (
            <li key={person.id} className="border-b border-line">
              <button
                type="button"
                className="flex min-h-touch w-full items-center justify-between gap-3 py-2 text-left"
                onClick={() => onChoose(person.id)}
              >
                <span className="min-w-0 break-words text-body">{person.name}</span>
                {!available && <span className="shrink-0 text-secondary text-warn">no disp.</span>}
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="py-4 text-body text-ink-soft">Nadie coincide con “{query}”.</li>
        )}
      </ul>

      <div className="flex flex-wrap justify-end gap-2">
        {canRemove && (
          <button
            type="button"
            className="btn-secondary mr-auto text-danger"
            onClick={() => onChoose(null)}
          >
            <X aria-hidden size={20} className="mr-1 inline" />
            Quitar
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Sheet>
  );
}
