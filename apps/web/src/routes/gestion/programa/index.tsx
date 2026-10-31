import {
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { onlineManager } from '@tanstack/react-query';
import { AlertTriangle, FileUp, Trash2, Upload, X } from 'lucide-react';
import type { MidweekWeek, WeekendMeeting } from '@territorios/core';
import {
  DataError,
  isConflictError,
  mutations,
  useDataMutation,
  useMyPermissions,
  useRole,
  type ProgramWeekRow,
} from '@territorios/data';
import { allowedParts, PART_LABEL, type ProgramaPart } from './access';
import { useProgramWeekList } from './data';
import {
  KIND_LABEL,
  buildPreview,
  defaultSelection,
  meetingDay,
  publishPlan,
  carryLinks,
  publishedSummary,
  restrictPreview,
  weekRange,
  type Preview,
  type PreviewEntry,
  type StagedFile,
} from './model';
import { readPdfPages } from './pdf';
import { EditarPrograma } from './editar/EditarTab';

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

type Outcome = { ok: number; failed: string[] };

type ImportTab = 'pdf' | 'editar';

const IMPORT_TABS: readonly { value: ImportTab; label: string }[] = [
  { value: 'pdf', label: 'Cargar PDF' },
  { value: 'editar', label: 'Editar a mano' },
];

/**
 * Gestión ▸ Programa. The program has two meetings with separate grants, so each gets its own
 * tab and only the parts the caller may edit are rendered (or saved). The PDF / Guía import
 * belongs to the midweek meeting; the weekend tab edits by hand.
 */
export function GestionPrograma() {
  const { isEditor } = useRole();
  const perms = useMyPermissions().data;
  const parts = allowedParts(perms, isEditor);
  const [choice, setChoice] = useState<ProgramaPart | null>(null);
  const part = choice && parts.includes(choice) ? choice : parts[0];

  if (!part) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-title font-bold">Programa</h2>
        <p className="text-body text-ink-soft">No tenés permiso para editar el programa.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The Gestión layout owns the page h1; this is the section heading. */}
      <h2 className="text-title font-bold">Programa</h2>

      {parts.length > 1 ? (
        <div
          className="segmented"
          role="radiogroup"
          aria-label="Reunión del programa"
          style={{ gridTemplateColumns: `repeat(${parts.length}, 1fr)` }}
        >
          {parts.map((p) => (
            <label key={p} className="segmented-item">
              <input
                type="radio"
                name="programa-part"
                value={p}
                checked={part === p}
                onChange={() => setChoice(p)}
              />
              <span>{PART_LABEL[p]}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-secondary text-ink-soft">
          Editás la reunión de {PART_LABEL[part].toLowerCase()}.
        </p>
      )}

      {part === 'midweek' ? <MidweekPrograma /> : <EditarPrograma part="weekend" />}
    </div>
  );
}

function MidweekPrograma() {
  const [tab, setTab] = useState<ImportTab>('pdf');
  return (
    <div className="flex flex-col gap-4">
      <div
        className="segmented"
        role="radiogroup"
        aria-label="Entre semana"
        style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
      >
        {IMPORT_TABS.map((t) => (
          <label key={t.value} className="segmented-item">
            <input
              type="radio"
              name="programa-tab"
              value={t.value}
              checked={tab === t.value}
              onChange={() => setTab(t.value)}
            />
            <span>{t.label}</span>
          </label>
        ))}
      </div>

      {tab === 'pdf' ? <CargarPdf kind="midweek" /> : <EditarPrograma part="midweek" />}
    </div>
  );
}

function CargarPdf({ kind }: { kind: ProgramaPart }) {
  const online = useOnline();
  const list = useProgramWeekList();
  const published = useMemo(
    () => (list.data ?? []).filter((row) => row.kind === kind),
    [list.data, kind],
  );

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  // Keys the editor unticked; everything publishable starts ticked.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [publishing, setPublishing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const create = useDataMutation(mutations.createProgramWeek);
  const update = useDataMutation(mutations.updateProgramWeek);

  // A PDF may carry both meetings; this tab only publishes its own.
  const preview = useMemo(
    () => (files.length ? restrictPreview(buildPreview(files, year, published), kind) : null),
    [files, year, published, kind],
  );
  const selected = useMemo(() => {
    if (!preview) return new Set<string>();
    const s = defaultSelection(preview);
    for (const k of excluded) s.delete(k);
    return s;
  }, [preview, excluded]);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    // Copy before resetting: the FileList is live and empties with the value.
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    setReading(true);
    setReadError(null);
    setOutcome(null);
    const read: StagedFile[] = [];
    const failed: string[] = [];
    for (const file of picked) {
      try {
        read.push({ name: file.name, pages: await readPdfPages(await file.arrayBuffer()) });
      } catch {
        failed.push(file.name);
      }
    }
    setFiles((prev) => [
      ...prev.filter((f) => !read.some((r) => r.name === f.name)),
      ...read,
    ]);
    if (failed.length) {
      setReadError(`No pudimos leer ${failed.join(', ')}. Probá descargar el PDF de nuevo.`);
    }
    setReading(false);
  }

  function toggle(key: string, on: boolean) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function discard() {
    setFiles([]);
    setExcluded(new Set());
    setReadError(null);
  }

  async function publish() {
    if (!preview) return;
    setPublishing(true);
    setOutcome(null);
    const result: Outcome = { ok: 0, failed: [] };
    const done = new Set<string>();
    for (const step of publishPlan(preview, selected)) {
      const { entry } = step;
      const data = entry.meeting.week as unknown as Record<string, unknown>;
      try {
        if (step.op === 'update') {
          await update.mutateAsync({
            id: step.row.id,
            version: step.row.version,
            weekStart: entry.weekStart,
            // Keep the person links an editor already made for the same names.
            patch: { data: carryLinks(data, step.row.data) },
          });
        } else {
          await create.mutateAsync({ kind: entry.kind, date: entry.date, data });
        }
        result.ok++;
        done.add(entry.key);
      } catch (err) {
        result.failed.push(`${KIND_LABEL[entry.kind]} ${meetingDay(entry.date)}: ${publishError(err)}`);
      }
    }
    setPublishing(false);
    setOutcome(result);
    if (result.failed.length === 0) discard();
    else setExcluded((prev) => new Set([...prev, ...done]));
  }

  const publishCount = preview ? publishPlan(preview, selected).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-8">
        <UploadForm
          kind={kind}
          year={year}
          onYear={setYear}
          onPick={onPick}
          reading={reading}
          hasFiles={files.length > 0}
        />

        {readError && (
          <p role="alert" className="text-body text-danger">
            {readError}
          </p>
        )}

        {outcome && (
          <div role="status" className="flex flex-col gap-1">
            {outcome.ok > 0 && (
              <p className="text-body font-semibold text-ok">
                {outcome.ok === 1 ? 'Publicamos 1 reunión.' : `Publicamos ${outcome.ok} reuniones.`}
              </p>
            )}
            {outcome.failed.map((f) => (
              <p key={f} className="text-body text-danger">
                {f}
              </p>
            ))}
          </div>
        )}

        {preview && (
          <PreviewSection
            preview={preview}
            selected={selected}
            onToggle={toggle}
            onDiscard={discard}
            onRemoveFile={(name) => setFiles((prev) => prev.filter((f) => f.name !== name))}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2"
                disabled={publishing || publishCount === 0 || !online || list.isPending}
                onClick={publish}
              >
                <Upload aria-hidden size={20} />
                {publishing
                  ? 'Publicando…'
                  : publishCount === 1
                    ? 'Publicar 1 reunión'
                    : `Publicar ${publishCount} reuniones`}
              </button>
              <button type="button" className="btn-secondary" onClick={discard} disabled={publishing}>
                Descartar
              </button>
              {!online && (
                <p className="text-secondary text-ink-soft">Sin conexión: publicá cuando vuelva.</p>
              )}
            </div>
          </PreviewSection>
        )}

        <PublishedSection list={list} published={published} online={online} />
      </div>
    </div>
  );
}

function publishError(err: unknown): string {
  if (isConflictError(err)) {
    return err.likelyPermissionDenied
      ? 'no tenés permiso para cambiarla.'
      : 'alguien la cambió mientras tanto. Volvé a elegir el PDF y publicá de nuevo.';
  }
  if (err instanceof DataError && err.isUniqueViolation) {
    return 'alguien la publicó recién. Volvé a elegir el PDF y publicá de nuevo.';
  }
  return 'no se pudo guardar. Revisá la conexión y probá de nuevo.';
}

function UploadForm({
  kind,
  year,
  onYear,
  onPick,
  reading,
  hasFiles,
}: {
  kind: ProgramaPart;
  year: number;
  onYear: (y: number) => void;
  onPick: (e: ChangeEvent<HTMLInputElement>) => void;
  reading: boolean;
  hasFiles: boolean;
}) {
  const yearId = useId();
  const fileId = useId();
  return (
    <section aria-labelledby={`${fileId}-h`} className="flex flex-col gap-4">
      <h2 id={`${fileId}-h`} className="text-heading font-bold">
        Subir programa de {KIND_LABEL[kind].toLowerCase()}
      </h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label htmlFor={yearId} className="flex flex-col gap-1">
          <span className="text-secondary font-semibold">Año</span>
          <input
            id={yearId}
            className="field w-28 font-mono"
            type="number"
            inputMode="numeric"
            min={2020}
            max={2100}
            value={year}
            onChange={(e) => {
              const y = Number(e.currentTarget.value);
              if (Number.isInteger(y) && y >= 2020 && y <= 2100) onYear(y);
            }}
          />
        </label>
        <label
          htmlFor={fileId}
          className="btn-secondary inline-flex cursor-pointer items-center justify-center gap-2 focus-within:outline-3 focus-within:outline-focus-ring"
          aria-disabled={reading}
        >
          <FileUp aria-hidden size={24} />
          {reading ? 'Leyendo PDF…' : hasFiles ? 'Agregar otro PDF' : 'Elegir PDF'}
          <input
            id={fileId}
            type="file"
            accept="application/pdf"
            multiple
            className="sr-only"
            disabled={reading}
            onChange={onPick}
          />
        </label>
      </div>
      <p className="text-secondary text-ink-soft">
        Subí el PDF de la reunión de {KIND_LABEL[kind].toLowerCase()}. Cada reunión se guarda por
        fecha: subir un mes no borra el anterior.
      </p>
    </section>
  );
}

function PreviewSection({
  preview,
  selected,
  onToggle,
  onDiscard,
  onRemoveFile,
  children,
}: {
  preview: Preview;
  selected: ReadonlySet<string>;
  onToggle: (key: string, on: boolean) => void;
  onDiscard: () => void;
  onRemoveFile: (name: string) => void;
  children: ReactNode;
}) {
  const warningCount = preview.entries.filter((e) => e.warnings.length || e.blocking).length;
  return (
    <section aria-labelledby="gp-preview-h" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="gp-preview-h" className="text-heading font-bold">
          Vista previa
        </h2>
        <button type="button" className="icon-btn" aria-label="Descartar vista previa" onClick={onDiscard}>
          <X aria-hidden size={24} />
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {preview.files.map((f) => (
          <li key={f.name} className="flex min-h-touch items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold">{f.name}</p>
              {f.error ? (
                <p className="text-secondary text-danger">{f.error}</p>
              ) : (
                <p className="text-secondary text-ink-soft">
                  {f.kind && KIND_LABEL[f.kind]} · {f.count === 1 ? '1 fecha' : `${f.count} fechas`}
                </p>
              )}
            </div>
            <button type="button" className="btn-secondary" onClick={() => onRemoveFile(f.name)}>
              Quitar
            </button>
          </li>
        ))}
      </ul>

      {preview.entries.length > 0 && (
        <p className="text-body text-ink-soft">
          {preview.entries.length === 1 ? '1 reunión' : `${preview.entries.length} reuniones`}
          {warningCount > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-warn">
                {warningCount === 1 ? '1 para revisar' : `${warningCount} para revisar`}
              </span>
            </>
          )}
        </p>
      )}

      {preview.groups.map((g) => (
        <div key={g.weekStart} className="flex flex-col gap-3">
          <h3 className="text-heading font-bold">Semana {weekRange(g.weekStart)}</h3>
          {g.entries.map((e) => (
            <EntryCard
              key={e.key}
              entry={e}
              checked={selected.has(e.key)}
              onToggle={(on) => onToggle(e.key, on)}
            />
          ))}
        </div>
      ))}

      {preview.entries.length > 0 && children}
    </section>
  );
}

function EntryCard({
  entry,
  checked,
  onToggle,
}: {
  entry: PreviewEntry;
  checked: boolean;
  onToggle: (on: boolean) => void;
}) {
  const id = useId();
  const flagged = entry.blocking !== null || entry.warnings.length > 0;
  return (
    <article
      aria-labelledby={`${id}-h`}
      className={`rounded-md border bg-surface ${flagged ? 'border-warn' : 'border-line'}`}
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h4 id={`${id}-h`} className="text-body font-bold">
            {KIND_LABEL[entry.kind]} · {meetingDay(entry.date)}
          </h4>
          {entry.existing && (
            <p className="text-secondary font-semibold text-ink-soft">Reemplaza lo publicado</p>
          )}
        </div>
        <label className="flex min-h-touch shrink-0 cursor-pointer items-center gap-2 text-secondary font-semibold">
          <input
            type="checkbox"
            className="size-5 accent-brand"
            checked={checked}
            disabled={entry.blocking !== null}
            onChange={(ev) => onToggle(ev.currentTarget.checked)}
          />
          Incluir
        </label>
      </div>

      {flagged && (
        <ul className="flex flex-col gap-1 border-b border-line px-4 py-3" aria-label="Para revisar">
          {entry.blocking && (
            <li className="flex gap-2 text-secondary font-semibold text-danger">
              <AlertTriangle aria-hidden size={18} className="mt-0.5 shrink-0" />
              {entry.blocking}
            </li>
          )}
          {entry.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-secondary text-warn">
              <AlertTriangle aria-hidden size={18} className="mt-0.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="px-4 py-3">
        {entry.meeting.kind === 'midweek' ? (
          <MidweekDetail week={entry.meeting.week} />
        ) : (
          <WeekendDetail meeting={entry.meeting.week} />
        )}
      </div>
    </article>
  );
}

const SECTION_LABEL = {
  inicio: 'Inicio',
  tesoros: 'Tesoros de la Biblia',
  maestros: 'Seamos mejores maestros',
  vida: 'Nuestra vida cristiana',
} as const;

function MidweekDetail({ week }: { week: MidweekWeek }) {
  if (week.asamblea) return <p className="text-body font-semibold">{week.asamblea}</p>;
  if (week.parts.length === 0) return <p className="text-body text-ink-soft">Sin partes.</p>;
  return (
    <ol className="flex flex-col divide-y divide-line">
      {week.parts.map((p, i) => {
        const newSection = i === 0 || week.parts[i - 1]!.section !== p.section;
        return (
          <li key={`${p.time}-${i}`} className="py-2">
            {newSection && (
              <p className="pb-1 text-caption font-semibold text-ink-soft">{SECTION_LABEL[p.section]}</p>
            )}
            <div className="flex gap-3">
              <time className="w-12 shrink-0 font-mono text-secondary text-ink-soft">{p.time}</time>
              <div className="min-w-0 flex-1">
                <p className="text-body break-words">{p.title}</p>
                {p.people.length > 0 && (
                  <p className="text-secondary text-ink-soft break-words">
                    {p.people.map((q, j) => (
                      <span key={j}>
                        {j > 0 && ', '}
                        <span className="font-semibold text-ink">{q.name}</span>
                        {q.role && ` (${q.role})`}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function WeekendDetail({ meeting: m }: { meeting: WeekendMeeting }) {
  const rows: Array<[string, string | null]> = [
    ['Hospitalidad', m.hospitalidad],
    ['Canción inicial', m.cancionInicio],
    ['Presidente', m.presidente],
    ['Discurso', m.discurso ? `${m.discurso.titulo}${m.discurso.tipo ? ` (${m.discurso.tipo.toLowerCase()})` : ''}` : null],
    ['Orador', m.discurso?.orador ? [m.discurso.orador, m.discurso.congregacion].filter(Boolean).join(' · ') : null],
    ['Sale a dar discurso', m.discurso?.saliente ?? null],
    ['Canción', m.cancionIntermedia],
    ['Conductor de La Atalaya', m.conductor],
    ['Lector', m.lector],
    ['Canción final', m.cancionFin],
    ['Oración final', m.oracionFinal],
    ['Discursantes salientes', m.discursantesSalientes.join(', ') || null],
  ];
  return (
    <div className="flex flex-col gap-2">
      {m.asamblea && <p className="text-body font-semibold">{m.asamblea}</p>}
      <dl className="flex flex-col divide-y divide-line">
        {rows
          // An assembly weekend prints only the talk; an empty "Sale a dar discurso" is normal.
          .filter(([label, value]) => value || (!m.asamblea && label !== 'Sale a dar discurso' && label !== 'Discursantes salientes'))
          .map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
              <dt className="text-secondary text-ink-soft sm:w-48 sm:shrink-0">{label}</dt>
              <dd className={`text-body break-words ${value ? 'font-semibold' : 'text-warn'}`}>
                {value ?? 'Sin dato'}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function PublishedSection({
  list,
  published,
  online,
}: {
  list: ReturnType<typeof useProgramWeekList>;
  published: ProgramWeekRow[];
  online: boolean;
}) {
  return (
    <section aria-labelledby="gp-published-h" className="flex flex-col gap-3">
      <h2 id="gp-published-h" className="text-heading font-bold">
        Publicado
      </h2>
      {list.isPending ? (
        <div aria-busy="true" aria-label="Cargando" className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 py-1">
              <div className="skeleton h-5 w-56" />
              <div className="skeleton h-4 w-40" />
            </div>
          ))}
        </div>
      ) : list.isError && !list.data ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-ink-soft">
            No pudimos cargar lo publicado. Revisá la conexión y probá de nuevo.
          </p>
          <button type="button" className="btn-secondary" onClick={() => void list.refetch()}>
            Reintentar
          </button>
        </div>
      ) : published.length === 0 ? (
        <p className="text-body text-ink-soft">
          Todavía no hay semanas publicadas. Cuando publiques un PDF, sus reuniones aparecen acá.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {published.map((row) => (
            <PublishedRow key={row.id} row={row} online={online} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PublishedRow({ row, online }: { row: ProgramWeekRow; online: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const del = useDataMutation(mutations.deleteProgramWeek);

  async function confirmDelete() {
    setError(null);
    try {
      await del.mutateAsync({ id: row.id, version: row.version });
    } catch (err) {
      setConfirming(false);
      setError(
        isConflictError(err) && !err.deleted && !err.likelyPermissionDenied
          ? 'Alguien la cambió recién. Revisala y volvé a intentar.'
          : isConflictError(err) && err.likelyPermissionDenied
            ? 'No tenés permiso para eliminarla.'
            : 'No se pudo eliminar. Revisá la conexión y probá de nuevo.',
      );
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold">
            {KIND_LABEL[row.kind]} · {meetingDay(row.date)}{' '}
            <span className="font-mono font-normal text-ink-soft">{row.date.slice(0, 4)}</span>
          </p>
          <p className="truncate text-secondary text-ink-soft">{publishedSummary(row)}</p>
        </div>
        {!confirming && (
          <button
            type="button"
            className="btn-secondary inline-flex shrink-0 items-center gap-2"
            disabled={!online || del.isPending}
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden size={20} />
            Eliminar
          </button>
        )}
      </div>
      {confirming && (
        <div role="group" aria-label="Confirmar eliminación" className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-secondary font-semibold">
            ¿Eliminar esta reunión? Los publicadores dejan de verla.
          </p>
          <button
            type="button"
            className="btn-primary bg-danger"
            disabled={del.isPending}
            onClick={confirmDelete}
          >
            {del.isPending ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
