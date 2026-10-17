/**
 * Gestión ▸ Personas: the congregation directory. Every name with assignments (carrito,
 * programa, salidas, privilegios) should be a person here, so accounts can be linked to it.
 * Per person: "En carrito", duty tags and other spellings. The "Nombres sin vincular" panel
 * turns unmatched names from name_sources() into people or aliases (docs/PRIVILEGIOS.md).
 */
import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useNameSources, usePeople, type NameSource, type PersonRow } from '@territorios/data';
import { EmptyState, TabSkeleton } from '../carrito/ui';
import { filterPeople, unmatchedNames } from './model';
import { NamesPanel } from './NamesPanel';
import { PersonItem } from './PersonItem';
import './personas.css';

type Show = 'todas' | 'carrito' | 'privilegios' | 'sin-privilegios';

const SHOW_LABEL: Record<Show, string> = {
  todas: 'Todas',
  carrito: 'En carrito',
  privilegios: 'Con privilegios',
  'sin-privilegios': 'Sin privilegios',
};

export function GestionPersonas() {
  const roster = usePeople();
  const sources = useNameSources();
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('todas');
  const searchId = useId();
  const showId = useId();

  const people = useMemo(() => roster.data?.people ?? [], [roster.data]);
  const unmatched = useMemo(() => unmatchedNames(sources.data ?? []), [sources.data]);
  const inCarrito = people.filter((p) => p.in_carrito).length;

  const shown = useMemo(() => {
    const byShow = people.filter((p) =>
      show === 'carrito'
        ? p.in_carrito
        : show === 'privilegios'
          ? p.duties.length > 0
          : show === 'sin-privilegios'
            ? p.duties.length === 0
            : true,
    );
    return filterPeople(byShow, query);
  }, [people, show, query]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-title font-bold">Personas</h2>
        {roster.data && (
          <p className="text-secondary text-ink-soft">
            {people.length === 1 ? '1 persona' : `${people.length} personas`} · {inCarrito} en carrito
            {unmatched.length > 0 &&
              ` · ${unmatched.length === 1 ? '1 nombre' : `${unmatched.length} nombres`} sin vincular`}
          </p>
        )}
      </div>

      {roster.isPending ? (
        <TabSkeleton />
      ) : roster.isError && !roster.data ? (
        <EmptyState
          title="No pudimos cargar las personas"
          body="Revisá la conexión y reintentá. Solo los encargados ven esta lista."
        >
          <button type="button" className="btn-secondary" onClick={() => void roster.refetch()}>
            Reintentar
          </button>
        </EmptyState>
      ) : (
        <>
          <NamesSection
            unmatched={unmatched}
            pending={sources.isPending}
            failed={sources.isError && !sources.data}
            onRetry={() => void sources.refetch()}
            people={people}
          />

          <section aria-labelledby={`${searchId}-h`} className="flex flex-col gap-3">
            <h3 id={`${searchId}-h`} className="text-heading font-bold">
              Directorio
            </h3>
            <div className="ps-filters">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={searchId} className="text-secondary text-ink-soft">
                  Buscar por nombre o por otra forma de escribirlo
                </label>
                <div className="ps-search">
                  <Search aria-hidden size={20} />
                  <input
                    id={searchId}
                    type="search"
                    className="field w-full"
                    value={query}
                    autoComplete="off"
                    placeholder="Nombre o apellido"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={showId} className="text-secondary text-ink-soft">
                  Mostrar
                </label>
                <select
                  id={showId}
                  className="field"
                  value={show}
                  onChange={(e) => setShow(e.target.value as Show)}
                >
                  {(Object.keys(SHOW_LABEL) as Show[]).map((s) => (
                    <option key={s} value={s}>
                      {SHOW_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {people.length === 0 ? (
              <EmptyState
                title="Todavía no hay personas"
                body="Creá personas desde “Nombres sin vincular” o desde Carrito ▸ Personas. Aparecen acá en cuanto se guardan."
              />
            ) : shown.length === 0 ? (
              <p className="py-6 text-body text-ink-soft">
                {query.trim()
                  ? `Nadie coincide con “${query.trim()}”.`
                  : `No hay personas en “${SHOW_LABEL[show]}”.`}
              </p>
            ) : (
              <ul className="flex flex-col border-t border-line" aria-label="Personas">
                {shown.map((person) => (
                  <PersonItem key={person.id} person={person} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function NamesSection({
  unmatched,
  pending,
  failed,
  onRetry,
  people,
}: {
  unmatched: NameSource[];
  pending: boolean;
  failed: boolean;
  onRetry: () => void;
  people: PersonRow[];
}) {
  if (pending) {
    return (
      <div aria-busy="true" aria-label="Cargando nombres sin vincular" className="ps-panel">
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-14 w-full" />
      </div>
    );
  }
  if (failed) {
    return (
      <div className="ps-panel">
        <p className="text-body">No pudimos revisar los nombres del programa y las salidas.</p>
        <button type="button" className="btn-secondary self-start" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  }
  if (unmatched.length === 0) {
    return (
      <p className="text-secondary text-ink-soft">
        Todos los nombres del programa, las salidas y los privilegios tienen su persona.
      </p>
    );
  }
  return <NamesPanel unmatched={unmatched} people={people} />;
}

export default GestionPersonas;
