import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SECTION_LABEL, dayHeading, groupParts, shortRange } from './model';
import type { ShareBlock } from './shareModel';
import { addDaysIso } from '../../lib/week';
import './programDocument.css';

const TITLE = 'Programa · Cong. Norte Villa Diego';

/**
 * The selected meetings as one black-on-white document. The same node is captured for the PNG
 * (off-screen, 900 px wide) and printed on A4 (`@media print` in programDocument.css hides the
 * rest of the app and shows only this), so both outputs always match.
 */
export function ProgramDocument({
  blocks,
  caption,
  onReady,
}: {
  blocks: ShareBlock[];
  caption: string;
  onReady?: (node: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) onReady?.(ref.current);
  }, [onReady]);

  // Portaled to <body> so printing can hide #root wholesale, dialog and all.
  return createPortal(
    <div className="pd-host" aria-hidden>
      <div ref={ref} className="pd-doc">
        <header className="pd-head">
          <h1>{TITLE}</h1>
          <p>{caption}</p>
        </header>
        {blocks.map((block) => (
          <Block key={block.key} block={block} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function Block({ block }: { block: ShareBlock }) {
  if (block.kind === 'assembly') {
    return (
      <section className="pd-block pd-assembly">
        <p className="pd-sub">{shortRange(block.monday, addDaysIso(block.monday, 6))}</p>
        <h2>{block.name}</h2>
        <p>Esta semana no hay partes: las reuniones son en la asamblea.</p>
      </section>
    );
  }
  if (block.kind === 'midweek') return <MidweekBlock block={block} />;
  return <WeekendBlock block={block} />;
}

function BlockHead({ title, date }: { title: string; date: string }) {
  return (
    <div className="pd-blockhead">
      <h2>{title}</h2>
      <p className="pd-sub">{dayHeading(date)}</p>
    </div>
  );
}

function MidweekBlock({ block }: { block: Extract<ShareBlock, { kind: 'midweek' }> }) {
  return (
    <section className="pd-block">
      <BlockHead title="Reunión de entre semana" date={block.week.date} />
      {groupParts(block.week.parts).map((group) => (
        <div key={group.section} className="pd-group">
          {group.section !== 'inicio' && <h3>{SECTION_LABEL[group.section]}</h3>}
          <ul>
            {group.parts.map((part, i) => (
              <li key={`${part.time}-${part.title}-${i}`}>
                <time>{part.time || '—'}</time>
                <div>
                  <p className="pd-strong">{part.title}</p>
                  {part.people.map((person, j) => (
                    <p key={`${person.name}-${j}`} className="pd-person">
                      {person.name}
                      {person.role && <span> · {person.role}</span>}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function WeekendBlock({ block }: { block: Extract<ShareBlock, { kind: 'weekend' }> }) {
  const m = block.meeting;
  const rows: Array<{ label: string; value: string | null; mono?: boolean }> = [
    { label: 'Hospitalidad', value: m.hospitalidad },
    { label: 'Canción inicial', value: m.cancionInicio, mono: true },
    { label: 'Presidente', value: m.presidente },
    { label: 'Canción', value: m.cancionIntermedia, mono: true },
    { label: 'Conductor', value: m.conductor },
    { label: 'Lector', value: m.lector },
    { label: 'Canción final', value: m.cancionFin, mono: true },
    { label: 'Oración final', value: m.oracionFinal },
    { label: 'Discursantes salientes', value: m.discursantesSalientes.join(', ') || null },
  ];
  const d = m.discurso;
  return (
    <section className="pd-block">
      <BlockHead title="Reunión del fin de semana" date={m.date} />
      {d && (
        <div className="pd-talk">
          <p className="pd-sub">{d.tipo ? `Discurso ${d.tipo.toLowerCase()}` : 'Discurso'}</p>
          {d.titulo && <p className="pd-strong">{d.titulo}</p>}
          {(d.orador || d.congregacion) && (
            <p>
              {d.orador}
              {d.congregacion ? ` · Congregación ${d.congregacion}` : ''}
            </p>
          )}
          {d.saliente && <p className="pd-sub">Discursante saliente: {d.saliente}</p>}
        </div>
      )}
      <dl>
        {rows
          .filter((r) => r.value)
          .map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd className={r.mono ? 'pd-mono' : undefined}>{r.value}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}
