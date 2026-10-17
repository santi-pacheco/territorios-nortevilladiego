/**
 * "Pegar desde Excel": paste rows from the roster sheet, review how every name resolved, then
 * "Guardar todo". Nothing is written before that. Saving re-reads the roster of the pasted dates
 * (they may span two months) for current versions, skips unchanged cells, leaves cells that were
 * empty in the paste as they are, and writes one CAS call at a time.
 */
import { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, CircleDashed, TriangleAlert } from 'lucide-react';
import {
  dutyRosterQuery,
  isConflictError,
  useClearDutyDay,
  useSetDutyDay,
  useUpsertDutyCell,
  type DutyPerson,
} from '@territorios/data';
import { DAY_KIND_LABEL, cellId, longDay, monthLabel, type Month } from '../../privilegios/model';
import { parsePaste, peopleFor, resolveName, type PastedCell, type PastedRow, type Resolution, type SkippedLine } from './paste';

/** Select value for "keep the pasted text as free text". */
const AS_TEXT = '__texto__';

interface PreviewCell extends PastedCell {
  res: Resolution;
  /** A person id, AS_TEXT, or '' while an ambiguous name is still unchosen. */
  choice: string;
}
interface PreviewRow extends Omit<PastedRow, 'cells'> {
  cells: PreviewCell[];
}
interface Preview {
  rows: PreviewRow[];
  skipped: SkippedLine[];
}
interface Result {
  saved: number;
  unchanged: number;
  conflicts: number;
  failed: number;
}

function buildPreview(text: string, month: Month, people: DutyPerson[]): Preview {
  const parsed = parsePaste(text, month);
  return {
    skipped: parsed.skipped,
    rows: parsed.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => {
        const res = resolveName(c.raw, c.role, people);
        const choice = res.status === 'resolved' ? res.person.id : res.status === 'unknown' ? AS_TEXT : '';
        return { ...c, res, choice };
      }),
    })),
  };
}

export function PastePanel({
  month,
  people,
  online,
  onClose,
}: {
  month: Month;
  people: DutyPerson[];
  online: boolean;
  onClose: () => void;
}) {
  const textId = useId();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const qc = useQueryClient();
  const upsert = useUpsertDutyCell();
  const setDay = useSetDutyDay();
  const clearDay = useClearDutyDay();
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const counts = useMemo(() => {
    const c = { resolved: 0, toChoose: 0, unknown: 0 };
    for (const r of preview?.rows ?? []) {
      for (const cell of r.cells) {
        if (cell.res.status === 'resolved') c.resolved++;
        else if (cell.res.status === 'ambiguous') c.toChoose++;
        else c.unknown++;
      }
    }
    return c;
  }, [preview]);
  const unchosen = (preview?.rows ?? []).reduce(
    (n, r) => n + r.cells.filter((c) => c.choice === '').length,
    0,
  );
  const saving = progress !== null;

  function review() {
    setResult(null);
    setPreview(buildPreview(text, month, people));
  }

  function choose(date: string, cell: PreviewCell, choice: string) {
    setPreview((p) =>
      p && {
        ...p,
        rows: p.rows.map((r) =>
          r.date !== date
            ? r
            : { ...r, cells: r.cells.map((c) => (c.role === cell.role && c.slot === cell.slot ? { ...c, choice } : c)) },
        ),
      },
    );
  }

  async function saveAll() {
    if (!preview || preview.rows.length === 0) return;
    const dates = preview.rows.map((r) => r.date);
    const tally: Result = { saved: 0, unchanged: 0, conflicts: 0, failed: 0 };
    const total = preview.rows.reduce((n, r) => n + (r.kind === 'normal' ? r.cells.length : 1), 0);
    let done = 0;
    setResult(null);
    setProgress({ done, total });

    const run = async (write: () => Promise<unknown>) => {
      try {
        await write();
        tally.saved++;
      } catch (err) {
        if (isConflictError(err) && !err.likelyPermissionDenied) tally.conflicts++;
        else tally.failed++;
      }
    };
    const step = () => setProgress({ done: ++done, total });

    let current;
    try {
      current = await qc.fetchQuery(dutyRosterQuery(dates[0]!, dates[dates.length - 1]!));
    } catch {
      setProgress(null);
      setResult({ ...tally, failed: total });
      return;
    }
    const marks = new Map(current.days.map((d) => [d.date, d]));
    const cells = new Map(current.rows.map((r) => [cellId(r.date, r.role, r.slot), r]));

    for (const row of preview.rows) {
      const mark = marks.get(row.date);
      if (row.kind !== 'normal') {
        if (mark && mark.kind === row.kind && (mark.note ?? null) === row.note) tally.unchanged++;
        else
          await run(() =>
            setDay.mutateAsync({ date: row.date, kind: row.kind, note: row.note, version: mark?.version }),
          );
        step();
        continue;
      }
      // Names pasted for a day marked as asamblea: it is a meeting again.
      if (mark && mark.kind !== 'normal' && row.cells.length > 0) {
        await run(() => clearDay.mutateAsync({ date: row.date, version: mark.version }));
      }
      for (const cell of row.cells) {
        const person = cell.choice === AS_TEXT ? null : (byId.get(cell.choice) ?? null);
        const existing = cells.get(cellId(row.date, cell.role, cell.slot));
        const same = person
          ? existing?.person_id === person.id
          : existing !== undefined && existing.person_id === null && existing.person_name === cell.raw;
        if (same) tally.unchanged++;
        else
          await run(() =>
            upsert.mutateAsync({
              date: row.date,
              role: cell.role,
              slot: cell.slot,
              person_id: person?.id ?? null,
              person_name: person?.name ?? cell.raw,
              version: existing?.version,
            }),
          );
        step();
      }
    }

    setProgress(null);
    setResult(tally);
    if (tally.conflicts === 0 && tally.failed === 0) {
      setText('');
      setPreview(null);
    }
  }

  return (
    <section
      aria-labelledby={`${textId}-title`}
      className="flex flex-col gap-4 rounded-md border border-line-strong bg-surface px-4 py-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${textId}-title`} className="text-heading font-bold">
          Pegar desde Excel
        </h3>
        <p className="max-w-prose text-body text-ink-soft">
          Copiá las filas de la planilla (fecha, computadora, sonido, los dos micrófonos y, si
          hay, los acomodadores) y pegalas acá. Antes de guardar vas a ver cómo quedó cada nombre.
        </p>
      </div>

      <label htmlFor={textId} className="sr-only">
        Filas copiadas de la planilla
      </label>
      <textarea
        id={textId}
        className="field min-h-40 w-full py-3"
        value={text}
        rows={8}
        spellCheck={false}
        placeholder={'MARTES 3-nov\tNombre\tNombre\tNombre\tNombre'}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={!text.trim() || saving} onClick={review}>
          Revisar
        </button>
        <button type="button" className="btn-secondary" disabled={saving} onClick={onClose}>
          Cerrar
        </button>
      </div>

      {result && <ResultLine result={result} />}

      {preview && (
        <div className="flex flex-col gap-4 border-t border-line pt-4">
          {preview.rows.length === 0 ? (
            <p className="text-body text-ink-soft">
              No encontramos fechas en lo que pegaste. Cada fila tiene que empezar con la fecha,
              por ejemplo “MARTES 3-nov” o “3/11”.
            </p>
          ) : (
            <p className="text-body" aria-live="polite">
              <strong>{preview.rows.length === 1 ? '1 fecha' : `${preview.rows.length} fechas`}</strong>
              {' · '}
              {counts.resolved} reconocidos · {counts.toChoose} para elegir · {counts.unknown} sin
              coincidencia
            </p>
          )}

          {preview.skipped.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-secondary font-semibold">
                Filas que no tomamos (sin una fecha que entendamos):
              </p>
              <ul className="flex flex-col text-secondary text-ink-soft">
                {preview.skipped.map((s) => (
                  <li key={s.line} className="break-words">
                    Línea {s.line}: {s.text.replace(/\t+/g, ' · ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {preview.rows.map((row) => (
              <li key={row.date} className="flex flex-col gap-2 border-b border-line pb-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h4 className="text-body-strong font-bold">{longDay(row.date)}</h4>
                  {row.kind !== 'normal' && (
                    <span className="text-secondary font-semibold">
                      {DAY_KIND_LABEL[row.kind]}: {row.note}
                    </span>
                  )}
                </div>
                {row.offDay && (
                  <p className="flex items-center gap-2 text-secondary text-warn">
                    <TriangleAlert aria-hidden size={18} />
                    No es martes ni sábado. Revisá la fecha.
                  </p>
                )}
                {row.kind === 'normal' && row.cells.length === 0 && (
                  <p className="text-secondary text-ink-soft">Sin nombres en esta fila.</p>
                )}
                {row.cells.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3">
                    {row.cells.map((cell) => (
                      <CellChoice
                        key={`${cell.role}-${cell.slot}`}
                        date={row.date}
                        cell={cell}
                        people={people}
                        disabled={saving}
                        onChoose={(choice) => choose(row.date, cell, choice)}
                      />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {preview.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={saving || unchosen > 0 || !online}
                onClick={() => void saveAll()}
              >
                {progress ? `Guardando ${progress.done} de ${progress.total}…` : 'Guardar todo'}
              </button>
              {unchosen > 0 && (
                <p className="text-secondary text-ink-soft">
                  {unchosen === 1 ? 'Falta elegir 1 nombre.' : `Faltan elegir ${unchosen} nombres.`}
                </p>
              )}
              {!online && <p className="text-secondary text-ink-soft">Sin conexión: guardá cuando vuelva.</p>}
            </div>
          )}
          <p className="text-secondary text-ink-soft">
            Las fechas sin año se toman de {monthLabel(month)}. Las celdas vacías no cambian lo que
            ya está cargado.
          </p>
        </div>
      )}
    </section>
  );
}

function ResultLine({ result }: { result: Result }) {
  const ok = result.conflicts === 0 && result.failed === 0;
  const parts = [
    result.saved === 1 ? 'Guardamos 1 cambio' : `Guardamos ${result.saved} cambios`,
    result.unchanged > 0 && `${result.unchanged} ya estaban así`,
  ].filter(Boolean);
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className={`text-body font-semibold ${ok ? 'text-ok' : ''}`}>{parts.join(' · ')}.</p>
      {result.conflicts > 0 && (
        <p className="text-body text-warn">
          {result.conflicts === 1
            ? 'Una celda la cambió otra persona mientras guardabas.'
            : `${result.conflicts} celdas las cambió otra persona mientras guardabas.`}{' '}
          Revisá el mes y volvé a guardar si hace falta.
        </p>
      )}
      {result.failed > 0 && (
        <p className="text-body text-danger">
          {result.failed === 1 ? 'Un cambio no se pudo guardar.' : `${result.failed} cambios no se pudieron guardar.`}{' '}
          Revisá la conexión y tocá “Guardar todo” otra vez: lo que ya se guardó no se repite.
        </p>
      )}
    </div>
  );
}

function CellChoice({
  date,
  cell,
  people,
  disabled,
  onChoose,
}: {
  date: string;
  cell: PreviewCell;
  people: DutyPerson[];
  disabled: boolean;
  onChoose: (choice: string) => void;
}) {
  const id = `paste-${date}-${cell.role}-${cell.slot}`;
  const pool = peopleFor(cell.role, people);
  const first = cell.res.status === 'ambiguous' ? cell.res.candidates : [];
  const firstIds = new Set(first.map((p) => p.id));
  const rest = pool.filter((p) => !firstIds.has(p.id));
  const { status } = cell.res;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-secondary text-ink-soft">
        {cell.label}: <span className="font-semibold text-ink break-words">{cell.raw}</span>
      </label>
      <select
        id={id}
        className="field w-full min-w-0"
        value={cell.choice}
        disabled={disabled}
        aria-describedby={`${id}-status`}
        onChange={(e) => onChoose(e.target.value)}
      >
        {cell.choice === '' && <option value="">Elegí a quién…</option>}
        {first.length > 0 && (
          <optgroup label="Coinciden">
            {first.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={AS_TEXT}>Dejar como texto</option>
        {rest.length > 0 && (
          <optgroup label={first.length > 0 ? 'Otras personas' : 'Personas'}>
            {rest.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p id={`${id}-status`} className="flex items-center gap-1.5 text-secondary">
        {cell.choice !== '' && cell.choice !== AS_TEXT ? (
          <>
            <Check aria-hidden size={18} className="shrink-0 text-ok" />
            <span className={status === 'resolved' ? 'text-ok' : ''}>
              {status === 'resolved' && cell.choice === cell.res.person.id ? 'Reconocido' : 'Elegido'}
            </span>
          </>
        ) : status === 'ambiguous' && cell.choice === '' ? (
          <>
            <CircleHelp aria-hidden size={18} className="shrink-0 text-warn" />
            <span className="text-warn">Hay más de una persona</span>
          </>
        ) : (
          <>
            <CircleDashed aria-hidden size={18} className="shrink-0 text-ink-soft" />
            <span className="text-ink-soft">
              {status === 'unknown' ? 'Sin coincidencia: queda como texto' : 'Queda como texto'}
            </span>
          </>
        )}
      </p>
    </div>
  );
}
