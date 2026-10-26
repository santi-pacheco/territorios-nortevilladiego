/**
 * One collapsible week of Gestión ▸ Programa ▸ Editar, for a single meeting.
 *
 * Lazily loads the week (midweek keyed by Tuesday, weekend by Saturday) when the section opens,
 * then hands it to `WeekForm`. Saving uses the existing @territorios/data mutations: insert when
 * the row does not exist, CAS update with the row version when it does. Only the meeting of
 * `part` is rendered and saved, so a midweek grant cannot touch the weekend row (the RLS policy
 * enforces the same rule). A CAS conflict (or a concurrent insert) shows "Alguien cambió esta
 * semana" and offers a reload that re-reads the row and resets the form.
 *
 * "Traer de la Guía de actividades" (per week, or a `guide` delivered by "Traer el mes") opens a
 * proposal over the midweek form; nothing changes until "Aplicar", nothing is saved until
 * "Guardar semana".
 */
import { useId, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, onlineManager } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  DataError,
  isConflictError,
  loadWorkbook,
  mutations,
  programWeekQuery,
  useDataMutation,
  type ProgramWeek,
  type ProgramWeekRow,
  WorkbookError,
} from '@territorios/data';
import {
  workbookWeekToMidweek,
  type MidweekWeek,
  type WorkbookWeek,
} from '@territorios/core';
import { addDaysIso } from '../../../../lib/week';
import { PART_LABEL, type ProgramaPart } from '../access';
import { MidweekEditor } from './MidweekEditor';
import { WeekendEditor } from './WeekendEditor';
import { MEETING_START, mergeGuide, type GuideDelivery, type GuideProposal } from './guide';
import {
  cleanMidweek,
  cleanWeekend,
  copyPartsFrom,
  emptyMidweek,
  emptyWeekend,
  hasMidweekContent,
  hasWeekendContent,
  midweekDate,
  sanitizeMidweek,
  sanitizeWeekend,
  weekLabel,
  weekendDate,
  type WeekendDraft,
} from './model';

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

function weekBadge(data: ProgramWeek, part: ProgramaPart): string {
  const loaded = part === 'midweek' ? data.midweek : data.weekend;
  return loaded ? PART_LABEL[part] : 'Sin cargar';
}

export function WeekSection({
  part,
  weekStart,
  defaultOpen,
  guide,
}: {
  part: ProgramaPart;
  weekStart: string;
  defaultOpen: boolean;
  guide: GuideDelivery | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // A week delivered by "Traer el mes" opens so its proposal is visible.
  const [seenGuide, setSeenGuide] = useState<number | null>(null);
  if (guide && guide.nonce !== seenGuide) {
    setSeenGuide(guide.nonce);
    setOpen(true);
  }
  const [reset, setReset] = useState(0);
  const bodyId = useId();
  const week = useQuery({ ...programWeekQuery(weekStart), enabled: open });

  async function reload() {
    await week.refetch();
    setReset((r) => r + 1);
  }

  return (
    <section className="rounded-md border border-line bg-surface">
      <h3 className="m-0">
        <button
          type="button"
          className="flex min-h-touch w-full items-center gap-3 px-4 py-3 text-left"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="min-w-0 flex-1">
            <span className="text-body-strong font-bold">{weekLabel(weekStart)}</span>
            {week.data && (
              <span className="ml-2 text-secondary text-ink-soft">{weekBadge(week.data, part)}</span>
            )}
          </span>
          {open ? <ChevronUp aria-hidden size={24} /> : <ChevronDown aria-hidden size={24} />}
        </button>
      </h3>

      <div id={bodyId} hidden={!open} className="border-t border-line px-4 py-4">
        {week.isPending ? (
          <WeekSkeleton />
        ) : week.isError && !week.data ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body text-ink-soft">
              No pudimos cargar esta semana. Revisá la conexión y probá de nuevo.
            </p>
            <button type="button" className="btn-secondary" onClick={() => void week.refetch()}>
              Reintentar
            </button>
          </div>
        ) : week.data ? (
          <WeekForm
            key={`${part}:${reset}`}
            part={part}
            weekStart={weekStart}
            data={week.data}
            guide={guide}
            onReload={reload}
          />
        ) : null}
      </div>
    </section>
  );
}

type Outcome = { saved: number; problems: string[]; conflict: boolean };

function saveError(err: unknown): string {
  if (isConflictError(err) && err.likelyPermissionDenied) return 'no tenés permiso para guardarla.';
  if (isConflictError(err) && err.deleted) return 'alguien la borró. Recargá la semana.';
  if (err instanceof DataError && err.isUniqueViolation) return 'alguien la creó recién. Recargá la semana.';
  return 'no se pudo guardar. Revisá la conexión y probá de nuevo.';
}

const GUIDE_ERROR = 'No pudimos traer la Guía de esta semana. Probá de nuevo o cargala a mano.';

function guideError(err: unknown): string {
  if (err instanceof WorkbookError && err.status === 403) return 'No tenés permiso para traer la Guía.';
  return GUIDE_ERROR;
}

function WeekForm({
  part,
  weekStart,
  data,
  guide,
  onReload,
}: {
  part: ProgramaPart;
  weekStart: string;
  data: ProgramWeek;
  guide: GuideDelivery | null;
  onReload: () => Promise<void>;
}) {
  const online = useOnline();
  const qc = useQueryClient();
  const create = useDataMutation(mutations.createProgramWeek);
  const update = useDataMutation(mutations.updateProgramWeek);

  const tuesday = midweekDate(weekStart);
  const saturday = weekendDate(weekStart);

  const [mid, setMid] = useState<MidweekWeek>(() =>
    data.midweek ? sanitizeMidweek(data.midweek.data, tuesday) : emptyMidweek(tuesday),
  );
  const [wend, setWend] = useState<WeekendDraft>(() =>
    data.weekend ? sanitizeWeekend(data.weekend.data, saturday) : emptyWeekend(saturday),
  );
  const [midRow, setMidRow] = useState<ProgramWeekRow | null>(data.midweek);
  const [wendRow, setWendRow] = useState<ProgramWeekRow | null>(data.weekend);

  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [fetchingGuide, setFetchingGuide] = useState(false);
  // The preview plus the converted Guía week: "Aplicar" merges again against the form as it is
  // then, so names typed while the preview is open are not lost.
  const [proposal, setProposal] = useState<{ preview: GuideProposal; guide: MidweekWeek } | null>(null);

  function propose(found: WorkbookWeek | null) {
    setProposal(null);
    if (!found) {
      setCopyNote('La Guía de esta semana todavía no está publicada. Cargala a mano.');
    } else if (mid.asamblea?.trim()) {
      setCopyNote('Esta semana es de asamblea: no hace falta traer la Guía.');
    } else {
      setCopyNote(null);
      const guideMid = workbookWeekToMidweek(found, { start: MEETING_START });
      setProposal({ preview: mergeGuide(mid, guideMid), guide: guideMid });
    }
  }

  // "Traer el mes" hands each week its Guía; turn a new delivery into a proposal. The Guía only
  // describes the midweek meeting.
  const [seenGuide, setSeenGuide] = useState<number | null>(null);
  if (part === 'midweek' && guide && guide.nonce !== seenGuide) {
    setSeenGuide(guide.nonce);
    propose(guide.week);
  }

  async function fetchGuide() {
    setFetchingGuide(true);
    setCopyNote(null);
    try {
      const res = await loadWorkbook({ weekStart });
      propose(res.weeks.find((w) => w.weekStart === weekStart) ?? null);
    } catch (err) {
      setProposal(null);
      setCopyNote(guideError(err));
    } finally {
      setFetchingGuide(false);
    }
  }

  function applyGuide() {
    if (!proposal) return;
    const { guide: guideMid } = proposal;
    setMid((cur) => mergeGuide(cur, guideMid).week);
    setProposal(null);
    setCopyNote('Trajimos la Guía de actividades. Completá los nombres y guardá la semana.');
  }

  async function copyPrevious() {
    setCopying(true);
    setCopyNote(null);
    try {
      const prev = await qc.fetchQuery(programWeekQuery(addDaysIso(weekStart, -7)));
      const prevMid = prev.midweek
        ? sanitizeMidweek(prev.midweek.data, addDaysIso(weekStart, -6))
        : null;
      const parts = copyPartsFrom(prevMid);
      if (parts.length === 0) {
        setCopyNote('La semana anterior no tiene partes para copiar.');
        return;
      }
      setMid((w) => ({ ...w, parts }));
      setCopyNote('Copiamos la estructura de la semana anterior. Completá los nombres.');
    } catch {
      setCopyNote('No pudimos leer la semana anterior. Probá de nuevo.');
    } finally {
      setCopying(false);
    }
  }

  async function save() {
    setSaving(true);
    setOutcome(null);
    const problems: string[] = [];
    let saved = 0;
    let conflict = false;

    if (part === 'midweek' && (midRow || hasMidweekContent(mid))) {
      const payload = cleanMidweek(mid, tuesday) as unknown as Record<string, unknown>;
      try {
        const row = midRow
          ? await update.mutateAsync({
              id: midRow.id,
              version: midRow.version,
              weekStart,
              patch: { data: payload },
            })
          : await create.mutateAsync({ kind: 'midweek', date: tuesday, data: payload });
        setMidRow(row);
        saved += 1;
      } catch (err) {
        if (isConflictError(err) && !err.likelyPermissionDenied && !err.deleted) conflict = true;
        else if (err instanceof DataError && err.isUniqueViolation) conflict = true;
        else problems.push(`Reunión de entre semana: ${saveError(err)}`);
      }
    }

    if (part === 'weekend' && (wendRow || hasWeekendContent(wend))) {
      const payload = cleanWeekend(wend, saturday) as unknown as Record<string, unknown>;
      try {
        const row = wendRow
          ? await update.mutateAsync({
              id: wendRow.id,
              version: wendRow.version,
              weekStart,
              patch: { data: payload },
            })
          : await create.mutateAsync({ kind: 'weekend', date: saturday, data: payload });
        setWendRow(row);
        saved += 1;
      } catch (err) {
        if (isConflictError(err) && !err.likelyPermissionDenied && !err.deleted) conflict = true;
        else if (err instanceof DataError && err.isUniqueViolation) conflict = true;
        else problems.push(`Reunión del fin de semana: ${saveError(err)}`);
      }
    }

    setSaving(false);
    setOutcome({ saved, problems, conflict });
  }

  return (
    <div className="flex flex-col gap-6">
      {part === 'midweek' ? (
        <MidweekEditor
          value={mid}
          onChange={setMid}
          onCopyPrevious={copyPrevious}
          copying={copying}
          note={copyNote}
          onFetchGuide={fetchGuide}
          fetchingGuide={fetchingGuide}
          proposal={proposal?.preview ?? null}
          onApplyGuide={applyGuide}
          onDiscardGuide={() => setProposal(null)}
        />
      ) : (
        <WeekendEditor value={wend} onChange={setWend} />
      )}

      {outcome?.conflict && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-sm border border-warn bg-surface px-3 py-3"
        >
          <p className="text-body">
            <strong>Alguien cambió esta semana.</strong> Lo que ves puede estar viejo.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void onReload()}>
            Recargar
          </button>
        </div>
      )}

      {outcome && !outcome.conflict && (
        <div role="status" className="flex flex-col gap-1">
          {outcome.saved > 0 && (
            <p className="text-body font-semibold text-ok">
              {outcome.saved === 1 ? 'Guardamos una reunión.' : `Guardamos ${outcome.saved} reuniones.`}
            </p>
          )}
          {outcome.problems.map((problem) => (
            <p key={problem} className="text-body text-danger">
              {problem}
            </p>
          ))}
          {outcome.saved === 0 &&
            outcome.problems.length === 0 && (
              <p className="text-body text-ink-soft">No había nada para guardar.</p>
            )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={saving || !online}
          onClick={save}
        >
          {saving ? 'Guardando…' : 'Guardar semana'}
        </button>
        {!online && (
          <p className="text-secondary text-ink-soft">Sin conexión: guardá cuando vuelva.</p>
        )}
      </div>
    </div>
  );
}

function WeekSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando la semana" className="flex flex-col gap-4">
      <div className="skeleton h-6 w-56" />
      <div className="skeleton h-11 w-full" />
      <div className="skeleton h-14 w-full" />
      <div className="skeleton h-6 w-48" />
      <div className="skeleton h-11 w-full" />
    </div>
  );
}
