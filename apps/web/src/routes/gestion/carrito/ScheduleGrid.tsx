/**
 * The whole schedule at once: every week of the period, every turn of every day.
 *
 * People move three ways: drag a name onto another turn (desktop; dropping on a name swaps),
 * tap a name and then tap the target turn / name (touch and keyboard), or use the pencil next
 * to a name to replace or remove it through the picker.
 */
import { useId, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { ArrowRightLeft, Pencil, Plus, X } from 'lucide-react';
import type { ScheduleEntry } from '@territorios/core';
import type { CartSlotRow } from '@territorios/data';
import { addDaysIso, dayName, mondayOfIso, timeRange, type WeekRef } from './model';
import type { CellRef, PersonRef } from './edit';

export interface GridSlot {
  slot: CartSlotRow;
  place: string;
}

export function ScheduleGrid({
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
  onNote,
}: {
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
  onPick: (cell: CellRef, index: number) => void;
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
    <div className="flex flex-col gap-6">
      {weeks.map((week) => (
        <section
          key={week.weekDate}
          aria-label={`Semana del ${week.weekLabel}`}
          className="flex flex-col gap-2"
        >
          <h3 className="text-heading font-bold">Semana del {week.weekLabel}</h3>
          <div className="overflow-x-auto pb-1">
            <div
              className="grid gap-2 sm:grid-cols-2 lg:[grid-template-columns:repeat(var(--cols),minmax(11rem,1fr))]"
              style={{ '--cols': slots.length } as CSSProperties}
            >
              {slots.map(({ slot, place }) => {
                const cell: CellRef = { weekDate: week.weekDate, slotId: slot.id };
                const entry = getEntry(week.weekDate, slot.id);
                // The scheduler anchors a clipped first week on the range start, not its Monday.
                const date = addDaysIso(mondayOfIso(week.weekDate), slot.iso_dow - 1);
                const outside = date < startDate || date > endDate;
                if (outside && !entry) return null;
                const key = `${week.weekDate}|${slot.id}`;
                return (
                  <Cell
                    key={slot.id}
                    cell={cell}
                    title={`${dayName(slot.iso_dow)} ${Number(date.slice(8))}`}
                    subtitle={`${timeRange(slot.start_time, slot.end_time)}, ${place}`}
                    max={slot.group_size}
                    entry={entry}
                    cancelled={blackouts.has(`${date}|${slot.id}`)}
                    personName={personName}
                    selection={selection}
                    highlight={highlight}
                    dropActive={overKey === key}
                    onSelect={onSelect}
                    onPick={onPick}
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
                  />
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function Cell({
  cell,
  title,
  subtitle,
  max,
  entry,
  cancelled,
  personName,
  selection,
  highlight,
  dropActive,
  onSelect,
  onPick,
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
  title: string;
  subtitle: string;
  max: number;
  entry: ScheduleEntry | undefined;
  cancelled: boolean;
  personName: (id: string) => string;
  selection: PersonRef | null;
  highlight: string | null;
  dropActive: boolean;
  onSelect: (ref: PersonRef | null) => void;
  onPick: (cell: CellRef, index: number) => void;
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
  const full = persons.length >= max;
  const dimmed = highlight !== null && !persons.includes(highlight);
  const canReceive = selection !== null && !persons.includes(selection.personId);

  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-sm border bg-surface p-3 transition-opacity ${
        dropActive ? 'border-focus-ring bg-canvas' : 'border-line'
      } ${dimmed ? 'opacity-40' : ''}`}
      onDragOver={onDragOverCell}
      onDragLeave={onDragLeaveCell}
      onDrop={(e) => {
        e.preventDefault();
        onDropCell();
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-body-strong font-semibold">{title}</p>
        <p
          className={`font-mono text-caption ${persons.length > max ? 'text-warn' : 'text-ink-soft'}`}
          title="Personas / lugares del turno"
        >
          {persons.length}/{max}
        </p>
      </div>
      <p className="break-words text-secondary text-ink-soft">{subtitle}</p>
      {cancelled && <p className="text-secondary text-warn">Sin carrito ese día</p>}

      <ul className="flex flex-col">
        {persons.map((id, index) => {
          const ref: PersonRef = { ...cell, personId: id };
          const isSelected = selection?.personId === id && sameCellRef(selection, cell);
          return (
            <li
              key={id}
              className={`flex items-center gap-1 rounded-sm ${
                isSelected ? 'bg-canvas outline outline-2 outline-focus-ring' : ''
              } ${highlight === id ? 'font-bold' : ''}`}
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
                aria-pressed={isSelected}
                aria-label={
                  selection && !isSelected
                    ? `Intercambiar a ${personName(selection.personId)} con ${personName(id)}`
                    : `${personName(id)}: ${isSelected ? 'quitar selección' : 'seleccionar para mover'}`
                }
                className="flex min-h-touch min-w-0 flex-1 cursor-grab items-center gap-2 text-left text-body"
                onDragStart={(e) => onDragStartPerson(e, ref)}
                onDragEnd={onDragEnd}
                onClick={() => {
                  if (!selection) onSelect(ref);
                  else if (isSelected) onSelect(null);
                  else onTapPerson(ref);
                }}
              >
                {selection && !isSelected && (
                  <ArrowRightLeft aria-hidden size={16} className="shrink-0 text-ink-soft" />
                )}
                <span className="min-w-0 break-words">{personName(id)}</span>
              </button>
              <button
                type="button"
                className="icon-btn shrink-0"
                aria-label={`Cambiar o quitar a ${personName(id)}`}
                onClick={() => onPick(cell, index)}
              >
                <Pencil aria-hidden size={20} />
              </button>
            </li>
          );
        })}
        {persons.length === 0 && (
          <li className="flex min-h-touch items-center text-secondary text-ink-soft">
            Sin asignar
          </li>
        )}
      </ul>

      {canReceive && (
        <button
          type="button"
          className="btn-primary inline-flex items-center justify-center gap-2"
          onClick={onTapCell}
        >
          <ArrowRightLeft aria-hidden size={20} />
          Mover acá
        </button>
      )}

      {!selection && (!full || persons.length === 0) && (
        <button
          type="button"
          className="inline-flex min-h-touch w-fit items-center gap-1 text-secondary font-semibold text-ink-soft hover:text-ink"
          onClick={() => onPick(cell, -1)}
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
        onChange={(e) => onNote(cell, e.target.value)}
      />
    </div>
  );
}

function sameCellRef(a: CellRef, b: CellRef): boolean {
  return a.slotId === b.slotId && mondayOfIso(a.weekDate) === mondayOfIso(b.weekDate);
}

/** Banner while a person is picked up: says who, and offers the way out. */
export function SelectionBar({
  name,
  onCancel,
}: {
  name: string;
  onCancel: () => void;
}) {
  return (
    <div
      role="status"
      className="sticky bottom-2 z-10 flex items-center justify-between gap-3 rounded-sm border border-line-strong bg-surface p-3 shadow-sm"
    >
      <p className="min-w-0 break-words text-body">
        Moviendo a <strong>{name}</strong>. Tocá «Mover acá» en otro turno, o a otra persona para
        intercambiar.
      </p>
      <button type="button" className="btn-secondary inline-flex shrink-0 items-center gap-1" onClick={onCancel}>
        <X aria-hidden size={20} />
        Cancelar
      </button>
    </div>
  );
}
