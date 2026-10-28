/**
 * The whole period as ONE continuous table: a row per week, a column per turn (schedule order).
 *
 * People are edited in place: tap a name to change it (picker), the small x removes it, an
 * "Agregar" line fills a free place and the note is a plain text field. People move by drag and
 * drop on desktop (dropping on a name swaps), or by "Mover" in the picker and then a tap on the
 * target cell (or on a name, to swap) on touch and keyboard.
 */
import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ArrowRightLeft, Plus, X } from 'lucide-react';
import type { ScheduleEntry } from '@territorios/core';
import type { CartSlotRow } from '@territorios/data';
import { addDaysIso, dayName, mondayOfIso, timeRange, type WeekRef } from './model';
import type { CellRef, PersonRef } from './edit';

export interface GridSlot {
  slot: CartSlotRow;
  place: string;
}

const CANCELLED_LABEL = 'Sin carrito';

type CellState = { kind: 'outside' } | { kind: 'cancelled' } | { kind: 'open' };

export function ScheduleGrid({
  title,
  weeks,
  slots,
  startDate,
  endDate,
  blackouts,
  getEntry,
  personName,
  selection,
  highlight,
  onSelect,
  onMove,
  onSwap,
  onPick,
  onRemove,
  onNote,
}: {
  title: string;
  weeks: readonly WeekRef[];
  slots: readonly GridSlot[];
  startDate: string;
  endDate: string;
  /** `date|slotId` of the turns cancelled for a day. */
  blackouts: ReadonlySet<string>;
  getEntry: (weekDate: string, slotId: string) => ScheduleEntry | undefined;
  personName: (id: string) => string;
  selection: PersonRef | null;
  highlight: string | null;
  onSelect: (ref: PersonRef | null) => void;
  onMove: (from: PersonRef, to: CellRef) => void;
  onSwap: (from: PersonRef, to: PersonRef) => void;
  /** `index` -1 = add a person to the turn. */
  onPick: (cell: CellRef, index: number) => void;
  onRemove: (cell: CellRef, index: number) => void;
  onNote: (cell: CellRef, note: string) => void;
}) {
  // The dragged person lives in a ref: dataTransfer is unreadable while dragging over a target.
  const dragging = useRef<PersonRef | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  function startDrag(event: DragEvent, ref: PersonRef) {
    dragging.current = ref;
    event.dataTransfer.effectAllowed = 'move';
    // Firefox only starts a drag when some data is set.
    event.dataTransfer.setData('text/plain', ref.personId);
    onSelect(null);
  }

  function allowDrop(event: DragEvent, key: string) {
    if (!dragging.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (overKey !== key) setOverKey(key);
  }

  function endDrag() {
    dragging.current = null;
    setOverKey(null);
  }

  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h3 className="text-title font-bold">{title}</h3>
      {/* Both axes scroll inside the frame so the header row and the Semana column stay put. */}
      <div className="max-h-[calc(100dvh-6rem)] overflow-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-max border-separate border-spacing-0 text-left lg:min-w-0">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} left-0 z-30 w-24 min-w-24`}>
                <span className="text-body-strong font-semibold text-ink-soft">Semana</span>
              </th>
              {slots.map(({ slot, place }) => (
                <th key={slot.id} scope="col" className={`${HEAD} z-20 min-w-36`}>
                  <span className="block text-body-strong font-bold">{dayName(slot.iso_dow)}</span>
                  <span className="block font-mono text-secondary font-semibold">
                    {timeRange(slot.start_time, slot.end_time)}
                  </span>
                  <span className="block break-words text-secondary font-normal text-ink-soft">
                    {place}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => {
              const monday = mondayOfIso(week.weekDate);
              const cells = slots.map(({ slot }): { slot: GridSlot['slot']; state: CellState } => {
                const entry = getEntry(week.weekDate, slot.id);
                // The scheduler anchors a clipped first week on the range start, not its Monday.
                const date = addDaysIso(monday, slot.iso_dow - 1);
                if ((date < startDate || date > endDate) && !entry) {
                  return { slot, state: { kind: 'outside' } };
                }
                const cancelled = blackouts.has(`${date}|${slot.id}`);
                return { slot, state: cancelled ? { kind: 'cancelled' } : { kind: 'open' } };
              });

              const row: ReactNode[] = [];
              for (let i = 0; i < cells.length; i++) {
                const current = cells[i];
                if (!current) continue;
                const { slot, state } = current;
                const cell: CellRef = { weekDate: week.weekDate, slotId: slot.id };
                const entry = getEntry(week.weekDate, slot.id);
                const empty = !entry || (entry.personIds.length === 0 && !entry.note);

                if (state.kind === 'outside') {
                  row.push(<td key={slot.id} className={`${BODY} bg-canvas`} aria-hidden />);
                  continue;
                }
                if (state.kind === 'cancelled' && empty) {
                  // Merge the run of cancelled, empty turns into one banner, as on the printed card.
                  let span = 1;
                  while (true) {
                    const next = cells[i + span];
                    if (!next || next.state.kind !== 'cancelled') break;
                    const e = getEntry(week.weekDate, next.slot.id);
                    if (e && (e.personIds.length > 0 || e.note)) break;
                    span++;
                  }
                  row.push(
                    <td
                      key={slot.id}
                      colSpan={span}
                      className={`${BODY} bg-canvas text-center align-middle`}
                    >
                      <span className="inline-block rounded-sm border border-line-strong bg-surface px-4 py-2 text-heading font-bold">
                        {CANCELLED_LABEL}
                      </span>
                    </td>,
                  );
                  i += span - 1;
                  continue;
                }
                const key = `${week.weekDate}|${slot.id}`;
                row.push(
                  <Cell
                    key={slot.id}
                    cell={cell}
                    label={`${week.weekLabel}, ${dayName(slot.iso_dow)} ${timeRange(slot.start_time, slot.end_time)}`}
                    max={slot.group_size}
                    entry={entry}
                    cancelled={state.kind === 'cancelled'}
                    personName={personName}
                    selection={selection}
                    highlight={highlight}
                    dropActive={overKey === key}
                    onSelect={onSelect}
                    onPick={onPick}
                    onRemove={onRemove}
                    onNote={onNote}
                    onDragStartPerson={startDrag}
                    onDragEnd={endDrag}
                    onDragOverCell={(e) => allowDrop(e, key)}
                    onDragLeaveCell={() => setOverKey((k) => (k === key ? null : k))}
                    onDropCell={() => {
                      const from = dragging.current;
                      endDrag();
                      if (from) onMove(from, cell);
                    }}
                    onDropPerson={(to) => {
                      const from = dragging.current;
                      endDrag();
                      if (from) onSwap(from, to);
                    }}
                    onTapCell={() => selection && onMove(selection, cell)}
                    onTapPerson={(to) => selection && onSwap(selection, to)}
                  />,
                );
              }

              return (
                <tr key={week.weekDate}>
                  <th
                    scope="row"
                    className={`${BODY} sticky left-0 z-10 w-24 min-w-24 bg-surface align-middle text-body-strong font-semibold`}
                  >
                    {week.weekLabel}
                  </th>
                  {row}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const HEAD =
  'sticky top-0 border-b border-r border-line bg-canvas px-2 py-3 align-top lg:px-3 last:border-r-0';
const BODY = 'border-b border-r border-line px-2 py-2 lg:px-3 align-top last:border-r-0';

function Cell({
  cell,
  label,
  max,
  entry,
  cancelled,
  personName,
  selection,
  highlight,
  dropActive,
  onSelect,
  onPick,
  onRemove,
  onNote,
  onDragStartPerson,
  onDragEnd,
  onDragOverCell,
  onDragLeaveCell,
  onDropCell,
  onDropPerson,
  onTapCell,
  onTapPerson,
}: {
  cell: CellRef;
  label: string;
  max: number;
  entry: ScheduleEntry | undefined;
  cancelled: boolean;
  personName: (id: string) => string;
  selection: PersonRef | null;
  highlight: string | null;
  dropActive: boolean;
  onSelect: (ref: PersonRef | null) => void;
  onPick: (cell: CellRef, index: number) => void;
  onRemove: (cell: CellRef, index: number) => void;
  onNote: (cell: CellRef, note: string) => void;
  onDragStartPerson: (event: DragEvent, ref: PersonRef) => void;
  onDragEnd: () => void;
  onDragOverCell: (event: DragEvent) => void;
  onDragLeaveCell: () => void;
  onDropCell: () => void;
  onDropPerson: (to: PersonRef) => void;
  onTapCell: () => void;
  onTapPerson: (to: PersonRef) => void;
}) {
  const noteId = useId();
  const persons = entry?.personIds ?? [];
  const free = Math.max(0, max - persons.length);
  const dimmed = highlight !== null && !persons.includes(highlight);
  const canReceive = selection !== null && !persons.includes(selection.personId);

  return (
    <td
      className={`${BODY} min-w-36 transition-opacity ${
        dropActive ? 'bg-canvas outline outline-2 -outline-offset-2 outline-focus-ring' : ''
      } ${dimmed ? 'opacity-40' : ''}`}
      onDragOver={onDragOverCell}
      onDragLeave={onDragLeaveCell}
      onDrop={(e) => {
        e.preventDefault();
        onDropCell();
      }}
    >
      <div className="flex flex-col">
        {cancelled && <p className="text-secondary font-semibold text-warn">{CANCELLED_LABEL}</p>}

        {persons.map((id, index) => {
          const ref: PersonRef = { ...cell, personId: id };
          const isSelected = selection?.personId === id && sameCellRef(selection, cell);
          return (
            <div
              key={id}
              className={`group relative flex items-center rounded-sm ${
                isSelected ? 'bg-canvas outline outline-2 outline-focus-ring' : ''
              }`}
              onDragOver={(e) => {
                e.stopPropagation();
                onDragOverCell(e);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDropPerson(ref);
              }}
            >
              <button
                type="button"
                draggable
                aria-label={
                  selection && !isSelected
                    ? `Intercambiar a ${personName(selection.personId)} con ${personName(id)}`
                    : `${personName(id)}, ${label}: cambiar o mover`
                }
                className={`flex min-h-touch min-w-0 flex-1 cursor-grab items-center gap-1 text-left text-body lg:min-h-9 ${
                  highlight === id ? 'font-bold' : ''
                }`}
                onDragStart={(e) => onDragStartPerson(e, ref)}
                onDragEnd={onDragEnd}
                onClick={() => {
                  if (!selection) onPick(cell, index);
                  else if (isSelected) onSelect(null);
                  else onTapPerson(ref);
                }}
              >
                {selection && !isSelected && (
                  <ArrowRightLeft aria-hidden size={16} className="shrink-0 text-ink-soft" />
                )}
                <span className="min-w-0 break-words">{personName(id)}</span>
              </button>
              {!selection && (
                <button
                  type="button"
                  className="grid h-11 w-7 shrink-0 place-items-center rounded-sm text-ink-soft hover:bg-canvas hover:text-ink lg:absolute lg:right-0 lg:h-9 lg:bg-surface lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
                  aria-label={`Quitar a ${personName(id)}`}
                  onClick={() => onRemove(cell, index)}
                >
                  <X aria-hidden size={16} />
                </button>
              )}
            </div>
          );
        })}

        {selection === null &&
          Array.from({ length: free }, (_, i) => (
            <button
              key={i}
              type="button"
              className="flex min-h-touch w-full items-center gap-1 text-left text-secondary text-ink-soft hover:text-ink lg:min-h-9"
              aria-label={`Agregar persona, ${label}`}
              onClick={() => onPick(cell, -1)}
            >
              <Plus aria-hidden size={16} className="shrink-0" />
              Agregar
            </button>
          ))}

        {canReceive && (
          <button
            type="button"
            className="my-1 flex min-h-touch w-full items-center justify-center gap-1 rounded-sm border border-dashed border-line-strong text-secondary font-semibold lg:min-h-9"
            onClick={onTapCell}
          >
            <ArrowRightLeft aria-hidden size={16} />
            Mover acá
          </button>
        )}

        <label htmlFor={noteId} className="sr-only">
          Nota, {label}
        </label>
        <input
          id={noteId}
          className="min-h-touch w-full bg-transparent text-secondary italic text-ink-soft placeholder:text-ink-soft focus:not-italic focus:text-ink lg:min-h-9"
          value={entry?.note ?? ''}
          placeholder="nota…"
          autoComplete="off"
          onChange={(e) => onNote(cell, e.target.value)}
        />
      </div>
    </td>
  );
}

function sameCellRef(a: CellRef, b: CellRef): boolean {
  return a.slotId === b.slotId && mondayOfIso(a.weekDate) === mondayOfIso(b.weekDate);
}

/** Banner while a person is picked up: says who, and offers the way out. */
export function SelectionBar({ name, onCancel }: { name: string; onCancel: () => void }) {
  return (
    <div
      role="status"
      className="sticky bottom-2 z-40 flex items-center justify-between gap-3 rounded-sm border border-line-strong bg-surface p-3 shadow-sm"
    >
      <p className="min-w-0 break-words text-body">
        Moviendo a <strong>{name}</strong>. Tocá «Mover acá» en otro turno, o a otra persona para
        intercambiar.
      </p>
      <button
        type="button"
        className="btn-secondary inline-flex shrink-0 items-center gap-1"
        onClick={onCancel}
      >
        <X aria-hidden size={20} />
        Cancelar
      </button>
    </div>
  );
}
