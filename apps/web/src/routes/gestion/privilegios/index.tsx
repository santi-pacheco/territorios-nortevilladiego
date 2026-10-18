/**
 * Gestión ▸ Privilegios: the month's meeting days (Tuesday and Saturday), each with its kind
 * (reunión / asamblea / sin reunión) and six role slots. Each slot is a PersonPicker over the
 * people with that duty: a choice links the person, "Usar «texto» sin vincular" keeps free text,
 * clearing empties the slot; it saves on choice. Every write is CAS on the row version; a conflict rolls back,
 * refetches and shows a notice. "Pegar desde Excel" fills many dates at once (PastePanel).
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ClipboardPaste, X } from 'lucide-react';
import {
  isConflictError,
  useClearDutyCell,
  useClearDutyDay,
  useDutyPeople,
  useDutyRoster,
  useSetDutyDay,
  useUpsertDutyCell,
  type ConflictError,
  type DirectoryPerson,
  type DutyDayKind,
  type DutyRole,
  type DutyRosterRow,
} from '@territorios/data';
import {
  DAY_KIND_LABEL,
  SLOTS,
  buildRosterDays,
  cellId,
  longDay,
  monthBounds,
  monthLabel,
  shiftMonth,
  type Month,
  type RosterDay,
  type Slot,
} from '../../privilegios/model';
import { PersonPicker, type PersonValue } from '../../../shell/PersonPicker';
import { PastePanel } from './PastePanel';

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

const ROLES: DutyRole[] = ['computadora', 'sonido', 'microfonista', 'acomodador'];

export function conflictMessage(err: ConflictError, what: string): string {
  if (err.likelyPermissionDenied) return 'No tenés permiso para editar privilegios.';
  return `Alguien cambió ${what} mientras editabas. Ya cargamos lo último: revisalo y, si hace falta, volvé a guardarlo.`;
}

export function GestionPrivilegios() {
  const [month, setMonth] = useState<Month>(() => {
    const t = new Date();
    return { year: t.getFullYear(), month: t.getMonth() };
  });
  const [pasting, setPasting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const online = useOnline();
  const { from, to } = monthBounds(month);
  const roster = useDutyRoster(from, to, { enabled: true });
  const peopleQuery = useDutyPeople({ enabled: true });
  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);

  const days = useMemo(
    () => buildRosterDays(month, roster.data?.rows ?? [], roster.data?.days ?? []),
    [month, roster.data],
  );

  const onConflict = (err: ConflictError, date: string) =>
    setNotice(conflictMessage(err, longDay(date).toLowerCase()));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-bold">Privilegios</h2>
        <p className="max-w-prose text-body text-ink-soft">
          Computadora, sonido, micrófonos y acomodadores de cada reunión. Cada persona se guarda
          al elegirla de la lista.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn"
            aria-label="Mes anterior"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
          >
            <ChevronLeft aria-hidden size={24} />
          </button>
          <p className="min-w-[10rem] text-center text-heading font-bold capitalize" aria-live="polite">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            className="icon-btn"
            aria-label="Mes siguiente"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
          >
            <ChevronRight aria-hidden size={24} />
          </button>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2"
          aria-expanded={pasting}
          onClick={() => setPasting((p) => !p)}
        >
          <ClipboardPaste aria-hidden size={20} />
          Pegar desde Excel
        </button>
      </div>

      {pasting && (
        <PastePanel month={month} people={people} online={online} onClose={() => setPasting(false)} />
      )}

      {notice && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-sm border border-warn bg-surface px-3 py-2"
        >
          <p className="flex-1 py-2 text-body">{notice}</p>
          <button
            type="button"
            className="icon-btn -my-1 -mr-2"
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
          >
            <X aria-hidden size={20} />
          </button>
        </div>
      )}

      {!online && (
        <p className="text-body text-ink-soft">
          Sin conexión: ves lo último que se cargó. Los cambios se guardan cuando vuelva.
        </p>
      )}

      {roster.isPending ? (
        <EditorSkeleton />
      ) : roster.isError && !roster.data ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-ink-soft">
            No pudimos cargar los privilegios de este mes. Revisá la conexión y probá de nuevo.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void roster.refetch()}>
            Reintentar
          </button>
        </div>
      ) : (
        <>
          {peopleQuery.isSuccess && people.length === 0 && (
            <p className="max-w-prose text-body text-ink-soft">
              Nadie tiene privilegios marcados todavía: podés escribir los nombres a mano, o
              marcarlos en la sección Personas para elegirlos de la lista.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {days.map((day) => (
              <li key={day.date}>
                <DayEditor
                  day={day}
                  online={online}
                  onConflict={(err) => onConflict(err, day.date)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DayEditor({
  day,
  online,
  onConflict,
}: {
  day: RosterDay;
  online: boolean;
  onConflict: (err: ConflictError) => void;
}) {
  const headingId = `priv-day-${day.date}`;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-md border border-line bg-surface px-4 py-3"
    >
      <DayKindControl
        key={day.mark?.version ?? 0}
        day={day} online={online} headingId={headingId} onConflict={onConflict} />
      {day.kind === 'normal' && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
          {SLOTS.map((slot) => {
            const row = day.cells.get(cellId(day.date, slot.role, slot.slot)) ?? null;
            return (
              <SlotField
                key={`${slot.role}-${slot.slot}-${row?.version ?? 0}`}
                date={day.date}
                slot={slot}
                row={row}
                online={online}
                onConflict={onConflict}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function DayKindControl({
  day,
  online,
  headingId,
  onConflict,
}: {
  day: RosterDay;
  online: boolean;
  headingId: string;
  onConflict: (err: ConflictError) => void;
}) {
  const setDay = useSetDutyDay({ onConflict });
  const clearDay = useClearDutyDay({ onConflict });
  const pending = setDay.isPending || clearDay.isPending;
  const kind: DutyDayKind = setDay.isPending
    ? setDay.variables.kind
    : clearDay.isPending
      ? 'normal'
      : day.kind;
  const [note, setNote] = useState(day.mark?.note ?? '');
  const failed = (setDay.isError && !isConflictError(setDay.error)) || (clearDay.isError && !isConflictError(clearDay.error));

  function changeKind(next: DutyDayKind) {
    if (next === day.kind) return;
    if (next === 'normal') {
      if (day.mark) clearDay.mutate({ date: day.date, version: day.mark.version });
      return;
    }
    const defaultNote = next === 'asamblea' ? 'Asamblea regional' : null;
    const n = note.trim() || defaultNote;
    setNote(n ?? '');
    setDay.mutate({ date: day.date, kind: next, note: n, version: day.mark?.version });
  }

  function commitNote() {
    const n = note.trim() || null;
    if (!day.mark || n === (day.mark.note ?? null)) return;
    setDay.mutate({ date: day.date, kind: day.mark.kind, note: n, version: day.mark.version });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-body-strong font-bold">
          {longDay(day.date)}
        </h3>
        <label className="flex items-center gap-2">
          <span className="sr-only">Tipo de día, {longDay(day.date)}</span>
          <select
            className="field w-auto"
            value={kind}
            disabled={pending || !online}
            onChange={(e) => changeKind(e.target.value as DutyDayKind)}
          >
            {(Object.keys(DAY_KIND_LABEL) as DutyDayKind[]).map((k) => (
              <option key={k} value={k}>
                {DAY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {kind !== 'normal' && (
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Texto que se muestra ese día</span>
          <input
            className="field"
            value={note}
            maxLength={200}
            disabled={pending || !online || !day.mark}
            placeholder={kind === 'asamblea' ? 'Asamblea regional' : 'Sin reunión'}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      )}
      {failed && (
        <p role="alert" className="text-secondary text-danger">
          No se pudo guardar. Revisá la conexión y probá de nuevo.
        </p>
      )}
    </div>
  );
}

/** One stable filter per role, so the picker's memo holds across renders. */
const DUTY_FILTER = Object.fromEntries(
  ROLES.map((role) => [role, (p: DirectoryPerson) => p.duties.includes(role)]),
) as Record<DutyRole, (p: DirectoryPerson) => boolean>;

function SlotField({
  date,
  slot,
  row,
  online,
  onConflict,
}: {
  date: string;
  slot: Slot;
  row: DutyRosterRow | null;
  online: boolean;
  onConflict: (err: ConflictError) => void;
}) {
  const upsert = useUpsertDutyCell({ onConflict });
  const clear = useClearDutyCell({ onConflict });
  /** The row this field last wrote, so a quick second edit uses the new version. */
  const [written, setWritten] = useState<DutyRosterRow | null>(null);
  const current = written && (!row || written.version > row.version) ? written : row;
  const pending = upsert.isPending || clear.isPending;
  const failed =
    (upsert.isError && !isConflictError(upsert.error)) || (clear.isError && !isConflictError(clear.error));
  const value: PersonValue = {
    person_id: current?.person_id ?? null,
    name: current?.person_name ?? '',
  };

  async function commit(next: PersonValue) {
    const key = { date, role: slot.role, slot: slot.slot };
    try {
      if (!next.name.trim()) {
        if (current) await clear.mutateAsync({ ...key, version: current.version });
        return;
      }
      const saved = await upsert.mutateAsync({
        ...key,
        person_id: next.person_id,
        person_name: next.name,
        version: current?.version,
      });
      setWritten(saved);
    } catch {
      // Conflicts are reported by onConflict (rolled back and refetched); other errors show below.
    }
  }

  return (
    <PersonPicker
      label={slot.label}
      placeholder="Nombre"
      value={value}
      filter={DUTY_FILTER[slot.role]}
      createDuties={[slot.role]}
      // Free text stays possible (the roster supports it), and is marked "Sin vincular".
      allowFreeText
      disabled={!online || pending}
      status={
        pending
          ? { text: 'Guardando…' }
          : failed
            ? { text: 'No se guardó. Probá de nuevo.', tone: 'danger' }
            : null
      }
      onChange={(next) => void commit(next)}
    />
  );
}

function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando los privilegios" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
          <div className="skeleton h-6 w-48" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="skeleton h-12" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
