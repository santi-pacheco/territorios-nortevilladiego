import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Undo2 } from 'lucide-react';
import {
  isConflictError,
  mutations,
  useCreateMeeting,
  useDataMutation,
  useDeleteMeeting,
  useServiceWeek,
  useUpdateMeeting,
  useUpdateServiceWeek,
  type ConflictError,
  type ServiceMeetingInsert,
  type ServiceMeetingRow,
  type ServiceMeetingUpdate,
  type ServiceWeekRow,
} from '@territorios/data';
import {
  DAY_NAME,
  DAY_SLUGS,
  DAY_TOKEN,
  WEEK_ORDER,
  addDaysIso,
  dateOfDow,
  fromIso,
  longDate,
  mondayOf,
} from '../../../lib/week';
import { ConflictSheet, type ConflictState } from './ConflictSheet';
import { MeetingRow } from './MeetingRow';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `?semana=` value is only trusted when it is a Monday (service_weeks.week_start). */
function parseWeekParam(value: string | null): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const date = fromIso(value);
  return date.getDay() === 1 ? value : null;
}

/** Recreate a deleted meeting. `position` is recomputed so the undo lands at the end. */
function meetingToInsert(m: ServiceMeetingRow, position: number): ServiceMeetingInsert {
  return {
    week_id: m.week_id,
    dow: m.dow,
    position,
    kind: m.kind,
    start_time: m.start_time,
    groups: m.groups,
    conductor: m.conductor,
    conductor_person_id: m.conductor_person_id ?? null,
    place: m.place,
    territory_ids: m.territory_ids,
    group_territories: m.group_territories,
  };
}

export function GestionSalidas() {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [params, setParams] = useSearchParams();
  const monday = parseWeekParam(params.get('semana')) ?? thisMonday;
  const isThisWeek = monday === thisMonday;

  const week = useServiceWeek(monday);
  const weekRow: ServiceWeekRow | null = week.data?.week ?? null;
  const remoteMeetings = week.data?.meetings;
  const meetings = useMemo(() => remoteMeetings ?? [], [remoteMeetings]);

  const createWeek = useDataMutation(mutations.createServiceWeek);
  const updateWeek = useUpdateServiceWeek();
  const createMeeting = useCreateMeeting();
  const deleteMeeting = useDeleteMeeting();

  // Versions we believe are current per meeting: a save bumps the row's version, so a second
  // edit before the refetch lands must not send the stale one (that would self-conflict).
  const versionsRef = useRef(new Map<string, number>());
  const attemptsRef = useRef(new Map<string, ServiceMeetingUpdate>());
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const onConflict = useCallback((error: ConflictError) => {
    const id = String(error.id);
    versionsRef.current.delete(id);
    setConflict({
      id,
      patch: attemptsRef.current.get(id) ?? {},
      current: error.current as ServiceMeetingRow | null,
    });
  }, []);

  const updateMeeting = useUpdateMeeting({ onConflict });

  const byDow = useMemo(() => {
    const map = new Map<number, ServiceMeetingRow[]>();
    for (const meeting of meetings) {
      const list = map.get(meeting.dow) ?? [];
      list.push(meeting);
      map.set(meeting.dow, list);
    }
    return map;
  }, [meetings]);

  function nextPosition(dow: number): number {
    const list = byDow.get(dow) ?? [];
    return list.reduce((max, m) => Math.max(max, m.position + 1), 0);
  }

  function goToWeek(next: string) {
    setParams(next === thisMonday ? {} : { semana: next }, { replace: true });
  }

  const saveMeeting = useCallback(
    async (meeting: ServiceMeetingRow, patch: ServiceMeetingUpdate) => {
      if (Object.keys(patch).length === 0) return;
      attemptsRef.current.set(meeting.id, patch);
      const version = versionsRef.current.get(meeting.id) ?? meeting.version;
      try {
        const row = await updateMeeting.mutateAsync({
          id: meeting.id,
          version,
          patch,
          weekStart: monday,
        });
        versionsRef.current.set(meeting.id, row.version);
      } catch (error) {
        if (isConflictError(error)) versionsRef.current.delete(meeting.id);
      }
    },
    [monday, updateMeeting],
  );

  function addMeeting(dow: number) {
    if (!weekRow) return;
    createMeeting.mutate({
      week_id: weekRow.id,
      dow,
      position: nextPosition(dow),
      kind: dow === 0 ? 'domingo' : 'normal',
      start_time: '',
      groups: '',
      conductor: '',
      place: '',
      territory_ids: [],
      group_territories: {},
    });
  }

  function removeMeeting(meeting: ServiceMeetingRow) {
    const position = meeting.position;
    deleteMeeting.mutate(
      {
        id: meeting.id,
        version: versionsRef.current.get(meeting.id) ?? meeting.version,
        weekStart: monday,
      },
      {
        onSuccess: () => {
          versionsRef.current.delete(meeting.id);
          setUndo({ meeting, position });
        },
      },
    );
  }

  // Undo: offering to recreate a deleted meeting for 6 seconds.
  const [undo, setUndo] = useState<{ meeting: ServiceMeetingRow; position: number } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  function runUndo() {
    if (!undo) return;
    createMeeting.mutate(meetingToInsert(undo.meeting, undo.position));
    setUndo(null);
  }

  // Conflict resolution -----------------------------------------------------
  function useTheirs() {
    setConflict(null);
  }

  async function keepMine() {
    const current = conflict?.current;
    if (!conflict || !current) return;
    attemptsRef.current.set(current.id, conflict.patch);
    try {
      const row = await updateMeeting.mutateAsync({
        id: current.id,
        version: current.version,
        patch: conflict.patch,
        weekStart: monday,
      });
      versionsRef.current.set(current.id, row.version);
      setConflict(null);
    } catch {
      // A second conflict keeps the sheet open with the fresher values.
    }
  }

  // Week label --------------------------------------------------------------
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const [weekConflict, setWeekConflict] = useState(false);
  const weekLabel = weekRow?.month_label ?? '';

  function commitLabel() {
    if (labelDraft === null || !weekRow) return;
    const value = labelDraft;
    setLabelDraft(null);
    if (value === weekRow.month_label) return;
    updateWeek
      .mutateAsync({
        id: weekRow.id,
        version: weekRow.version,
        patch: { month_label: value },
        weekStart: monday,
      })
      .catch((error) => {
        if (isConflictError(error)) setWeekConflict(true);
      });
  }

  return (
    <div className="flex flex-col gap-5">
      <WeekNav
        monday={monday}
        isThisWeek={isThisWeek}
        onPrev={() => goToWeek(addDaysIso(monday, -7))}
        onNext={() => goToWeek(addDaysIso(monday, 7))}
        onToday={() => goToWeek(thisMonday)}
      />

      {week.isPending ? (
        <WeekSkeleton />
      ) : week.isError && !week.data ? (
        <EmptyState
          title="No pudimos cargar las salidas"
          body="Revisá la conexión. Cuando vuelva, se actualizan solas."
        >
          <button type="button" className="btn-secondary" onClick={() => void week.refetch()}>
            Reintentar
          </button>
        </EmptyState>
      ) : !weekRow ? (
        <EmptyState
          title="Esta semana todavía no existe"
          body="Creá la semana para empezar a cargar salidas. Podés editarla cuando quieras."
        >
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={createWeek.isPending}
            onClick={() => createWeek.mutate({ week_start: monday })}
          >
            <Plus aria-hidden size={20} />
            {createWeek.isPending ? 'Creando…' : 'Crear semana'}
          </button>
          {createWeek.isError && (
            <p role="alert" className="text-secondary text-danger">
              No pudimos crear la semana. Puede que ya exista para esa fecha.
            </p>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="week-label" className="text-caption text-ink-soft">
              Mes en la tarjeta
            </label>
            <input
              id="week-label"
              type="text"
              className="field sm:max-w-xs"
              placeholder="Octubre"
              value={labelDraft ?? weekLabel}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
            />
            {weekConflict && (
              <p role="alert" className="text-secondary text-danger">
                Alguien cambió la semana. Recargamos los datos; revisá el mes.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-6">
            {WEEK_ORDER.map((dow) => (
              <DaySection
                key={dow}
                dow={dow}
                monday={monday}
                meetings={byDow.get(dow) ?? []}
                onAdd={() => addMeeting(dow)}
                onSave={saveMeeting}
                onDelete={removeMeeting}
              />
            ))}
          </div>
        </>
      )}

      {conflict && (
        <ConflictSheet
          conflict={conflict}
          pending={updateMeeting.isPending}
          onUseTheirs={useTheirs}
          onKeepMine={keepMine}
        />
      )}

      {undo && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit max-w-[92%] items-center gap-3 rounded-full bg-ink px-4 py-2 text-secondary text-canvas shadow-sheet lg:bottom-6"
        >
          <span>Salida borrada.</span>
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={runUndo}
          >
            <Undo2 aria-hidden size={16} className="mr-1 inline" />
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}

function WeekNav({
  monday,
  isThisWeek,
  onPrev,
  onNext,
  onToday,
}: {
  monday: string;
  isThisWeek: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="icon-btn -ml-3" aria-label="Semana anterior" onClick={onPrev}>
        <ChevronLeft aria-hidden size={22} />
      </button>
      <span className="text-body-strong">
        {isThisWeek ? 'Esta semana · ' : 'Semana del '}
        {longDate(fromIso(monday))}
      </span>
      <button type="button" className="icon-btn" aria-label="Semana siguiente" onClick={onNext}>
        <ChevronRight aria-hidden size={22} />
      </button>
      {!isThisWeek && (
        <button
          type="button"
          className="btn-secondary ml-1 inline-flex items-center gap-2"
          onClick={onToday}
        >
          <CalendarDays aria-hidden size={20} />
          Ir a esta semana
        </button>
      )}
    </div>
  );
}

function DaySection({
  dow,
  monday,
  meetings,
  onAdd,
  onSave,
  onDelete,
}: {
  dow: number;
  monday: string;
  meetings: ServiceMeetingRow[];
  onAdd: () => void;
  onSave: (meeting: ServiceMeetingRow, patch: ServiceMeetingUpdate) => void;
  onDelete: (meeting: ServiceMeetingRow) => void;
}) {
  const date = dateOfDow(monday, dow);
  const ordered = [...meetings].sort((a, b) => a.position - b.position);
  return (
    <section
      aria-labelledby={`day-${DAY_SLUGS[dow]}`}
      data-day={DAY_SLUGS[dow]}
      style={{ '--day': `var(--tk-day-${DAY_TOKEN[dow]}-accent)` } as React.CSSProperties}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span
          aria-hidden
          className="inline-block h-1.5 w-8 rounded-full"
          style={{ backgroundColor: 'var(--day)' }}
        />
        <h3 id={`day-${DAY_SLUGS[dow]}`} className="text-heading font-bold">
          {DAY_NAME[dow]} {date.getDate()}
        </h3>
      </div>

      {ordered.length === 0 ? (
        <p className="mb-2 text-secondary text-ink-soft">Sin salidas cargadas.</p>
      ) : (
        <div className="mb-2 flex flex-col gap-3">
          {ordered.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              onSave={(patch) => onSave(meeting, patch)}
              onDelete={() => onDelete(meeting)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-2"
        onClick={onAdd}
      >
        <Plus aria-hidden size={20} />
        Agregar salida
      </button>
    </section>
  );
}

function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <h2 className="text-heading font-bold">{title}</h2>
      <p className="max-w-prose text-body text-ink-soft">{body}</p>
      {children}
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando las salidas" className="flex flex-col gap-6">
      {[0, 1].map((block) => (
        <div key={block} className="flex flex-col gap-3">
          <div className="skeleton h-6 w-40" />
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
