/**
 * "Nombres sin vincular": names used in the program, salidas or privilegios that match no
 * person. Each one becomes a new person ("Crear persona") or another spelling of an existing
 * one ("Es otro nombre de…"). Both writes invalidate name_sources, so the name leaves the list.
 */
import { useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { inferGender } from '@territorios/core';
import {
  DataError,
  useAddPersonAlias,
  useCreatePersonFromName,
  type Gender,
  type NameSource,
  type PersonRow,
} from '@territorios/data';
import { Sheet, errorMessage } from '../carrito/ui';
import { describeSource, filterPeople } from './model';

const FIRST_PAGE = 6;

type Action = { kind: 'create' | 'alias'; source: NameSource };

export function NamesPanel({ unmatched, people }: { unmatched: NameSource[]; people: PersonRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const headingId = useId();
  const visible = showAll ? unmatched : unmatched.slice(0, FIRST_PAGE);

  return (
    <section aria-labelledby={headingId} className="ps-panel">
      <div>
        <h3 id={headingId} className="text-heading font-bold">
          Nombres sin vincular <span className="font-mono text-ink-soft">{unmatched.length}</span>
        </h3>
        <p className="max-w-prose text-secondary text-ink-soft">
          Están en el programa, las salidas o los privilegios y no coinciden con ninguna persona.
          Vinculalos para que esas asignaciones le lleguen a quien corresponde.
        </p>
      </div>

      <ul className="flex flex-col">
        {visible.map((source) => {
          const info = describeSource(source);
          return (
            <li key={source.norm} className="ps-name">
              <div className="min-w-0">
                <p className="text-body-strong font-semibold break-words">{source.name}</p>
                <p className="text-secondary text-ink-soft">
                  {info.where} · {info.uses}
                  {info.when && <> · {info.when}</>}
                </p>
              </div>
              <div className="ps-name-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAction({ kind: 'create', source })}
                >
                  Crear persona
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAction({ kind: 'alias', source })}
                >
                  Es otro nombre de…
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {unmatched.length > FIRST_PAGE && (
        <button type="button" className="btn-secondary self-start" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Ver menos' : `Ver los ${unmatched.length} nombres`}
        </button>
      )}

      {action?.kind === 'create' && (
        <CreatePersonSheet source={action.source} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'alias' && (
        <AliasSheet source={action.source} people={people} onClose={() => setAction(null)} />
      )}
    </section>
  );
}

function CreatePersonSheet({ source, onClose }: { source: NameSource; onClose: () => void }) {
  const create = useCreatePersonFromName();
  const [gender, setGender] = useState<Gender | null>(() => inferGender(source.name));
  const [inCarrito, setInCarrito] = useState(false);
  const genderName = useId();
  const carritoName = useId();
  const guessed = useMemo(() => inferGender(source.name) !== null, [source.name]);

  function save() {
    if (!gender) return;
    create.mutate({ name: source.name, gender, inCarrito }, { onSuccess: onClose });
  }

  return (
    <Sheet title="Crear persona" onClose={onClose}>
      <div>
        <p className="text-secondary text-ink-soft">Nombre</p>
        <p className="text-body-strong font-semibold break-words">{source.name}</p>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-secondary text-ink-soft">Género</legend>
        <div className="flex flex-wrap gap-x-6">
          {(['F', 'M'] as const).map((value) => (
            <label key={value} className="flex min-h-touch items-center gap-2 text-body">
              <input
                type="radio"
                name={genderName}
                className="ps-radio"
                checked={gender === value}
                onChange={() => setGender(value)}
              />
              {value === 'F' ? 'Mujer' : 'Varón'}
            </label>
          ))}
        </div>
        <p className="text-secondary text-ink-soft">
          {guessed ? 'Lo sugerimos por el nombre; podés cambiarlo.' : 'Elegí uno para poder guardar.'}
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-secondary text-ink-soft">¿Participa en el carrito?</legend>
        <div className="flex flex-wrap gap-x-6">
          {([false, true] as const).map((value) => (
            <label key={String(value)} className="flex min-h-touch items-center gap-2 text-body">
              <input
                type="radio"
                name={carritoName}
                className="ps-radio"
                checked={inCarrito === value}
                onChange={() => setInCarrito(value)}
              />
              {value ? 'Sí' : 'No'}
            </label>
          ))}
        </div>
      </fieldset>

      {create.isError && (
        <p role="alert" className="text-secondary text-danger">
          {create.error instanceof DataError && create.error.isUniqueViolation
            ? 'Ese nombre ya coincide con una persona. Cerrá y revisá el directorio.'
            : errorMessage(create.error)}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" disabled={!gender || create.isPending} onClick={save}>
          {create.isPending ? 'Creando…' : 'Crear persona'}
        </button>
      </div>
    </Sheet>
  );
}

function AliasSheet({
  source,
  people,
  onClose,
}: {
  source: NameSource;
  people: PersonRow[];
  onClose: () => void;
}) {
  const addAlias = useAddPersonAlias();
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const searchId = useId();
  const optionName = useId();
  const shown = useMemo(() => filterPeople(people, query), [people, query]);

  function save() {
    if (!choice) return;
    addAlias.mutate({ personId: choice, alias: source.name }, { onSuccess: onClose });
  }

  return (
    <Sheet title={`“${source.name}” es otro nombre de…`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label htmlFor={searchId} className="text-secondary text-ink-soft">
          Buscar la persona
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

        <fieldset className="ps-options">
          <legend className="sr-only">Persona</legend>
          {shown.map((p) => (
            <label key={p.id} className="ps-option">
              <input
                type="radio"
                name={optionName}
                checked={choice === p.id}
                onChange={() => setChoice(p.id)}
              />
              <span className="min-w-0">
                <span className="block break-words">{p.name}</span>
                {p.aliases.length > 0 && (
                  <span className="block break-words text-secondary text-ink-soft">
                    También: {p.aliases.join(', ')}
                  </span>
                )}
              </span>
            </label>
          ))}
          {shown.length === 0 && (
            <p className="px-3 py-3 text-secondary text-ink-soft">
              {people.length === 0
                ? 'Todavía no hay personas. Usá “Crear persona”.'
                : `Nadie coincide con “${query.trim()}”.`}
            </p>
          )}
        </fieldset>

        {addAlias.isError && (
          <p role="alert" className="text-secondary text-danger">
            {addAlias.error instanceof DataError && addAlias.error.isUniqueViolation
              ? 'Ese nombre ya corresponde a otra persona.'
              : errorMessage(addAlias.error)}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={!choice || addAlias.isPending} onClick={save}>
            {addAlias.isPending ? 'Guardando…' : 'Vincular'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
