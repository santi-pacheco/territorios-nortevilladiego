/**
 * PersonPicker: the one way an editor names a person in a schedule (Salidas conductor, Programa
 * parts and weekend fields, Privilegios cells). It is an ARIA 1.2 combobox: a text input with
 * an inline listbox popover that searches the people directory (name + aliases, word prefixes,
 * accent/case-insensitive) so the entry links to the person and, through profiles.person_id, to
 * their account. Mis asignaciones and the reminders then match by link, not by spelling.
 *
 * Value = { person_id, name }. person_id null means free text ("sin vincular"): only pickers
 * with `allowFreeText` produce it on purpose (a visiting speaker); legacy values arrive that way
 * too, and when the stored name names exactly one person the picker offers a one-tap "Vincular"
 * (never written automatically).
 *
 * Footer actions: "Crear persona «texto»" (create_person_from_name, gender preset by
 * inferGender) and, with `allowFreeText`, "Usar «texto» sin vincular".
 */
import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Check, Link2, UserPlus, UserRound, X } from 'lucide-react';
import { inferGender, type Gender } from '@territorios/core';
import {
  DataError,
  exactPeople,
  normName,
  searchPeople,
  uniquePerson,
  useCreatePersonFromName,
  usePeopleDirectory,
  type DirectoryPerson,
  type DutyRole,
} from '@territorios/data';

export interface PersonValue {
  person_id: string | null;
  name: string;
}

export const EMPTY_PERSON: PersonValue = { person_id: null, name: '' };

/** At most this many people are listed; typing narrows the rest. */
const MAX_SHOWN = 30;

export type PickerOption =
  | { kind: 'person'; person: DirectoryPerson; alias: string | null }
  | { kind: 'create'; text: string }
  | { kind: 'free'; text: string };

/** The listbox for a query: matching people, then the footer actions. Pure (tested). */
export function pickerOptions(
  people: readonly DirectoryPerson[],
  query: string,
  opts: { allowFreeText?: boolean; canCreate?: boolean } = {},
): PickerOption[] {
  const text = query.replace(/\s+/g, ' ').trim();
  const out: PickerOption[] = searchPeople(people, text)
    .slice(0, MAX_SHOWN)
    .map((h) => ({ kind: 'person', person: h.person, alias: h.alias }));
  if (text) {
    if (opts.canCreate !== false && exactPeople(people, text).length === 0) {
      out.push({ kind: 'create', text });
    }
    if (opts.allowFreeText) out.push({ kind: 'free', text });
  }
  return out;
}

/**
 * What a typed text commits to when the field loses focus without a choice: an exact single
 * match links; blank clears; otherwise free text when allowed, else the old value stays.
 * Pure (tested).
 */
export function resolveTyped(
  people: readonly DirectoryPerson[],
  text: string,
  current: PersonValue,
  allowFreeText: boolean,
): PersonValue {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return EMPTY_PERSON;
  if (current.name && normName(t) === normName(current.name)) return current;
  const person = uniquePerson(people, t);
  if (person) return { person_id: person.id, name: person.name };
  return allowFreeText ? { person_id: null, name: t } : current;
}

/** For a legacy unlinked value: the one person its name names exactly, if any. Pure (tested). */
export function linkSuggestion(
  people: readonly DirectoryPerson[],
  value: PersonValue,
): DirectoryPerson | null {
  if (value.person_id || !value.name.trim()) return null;
  return uniquePerson(people, value.name);
}

export function PersonPicker({
  label,
  hideLabel = false,
  labelClassName = 'text-secondary text-ink-soft',
  value,
  onChange,
  people: peopleProp,
  filter,
  allowFreeText = false,
  createDuties,
  disabled = false,
  placeholder = 'Buscar por nombre',
  status,
}: {
  label: string;
  /** Keep the label for screen readers only (dense rows where a column header names it). */
  hideLabel?: boolean;
  /** Match the neighbouring fields' label style (Salidas uses captions). */
  labelClassName?: string;
  value: PersonValue;
  onChange: (value: PersonValue) => void;
  /** Override the directory (tests); defaults to usePeopleDirectory(). */
  people?: readonly DirectoryPerson[];
  /** Narrow the list, e.g. by duty or in_carrito. Linking checks use the same subset. */
  filter?: (person: DirectoryPerson) => boolean;
  allowFreeText?: boolean;
  /** Duties given to a person created from this picker (Privilegios). */
  createDuties?: DutyRole[];
  disabled?: boolean;
  placeholder?: string;
  /** Extra line under the field (saving / error), replaces the link status while shown. */
  status?: { text: string; tone?: 'muted' | 'danger' } | null;
}) {
  const directory = usePeopleDirectory(peopleProp ? { enabled: false } : {});
  const all = useMemo(() => peopleProp ?? directory.data ?? [], [peopleProp, directory.data]);
  const people = useMemo(() => (filter ? all.filter(filter) : all), [all, filter]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const hintId = `${id}-hint`;

  const text = query ?? value.name;
  const options = useMemo(
    () => pickerOptions(people, query ?? '', { allowFreeText }),
    [people, query, allowFreeText],
  );
  const activeIndex = Math.min(active, options.length - 1);
  const suggestion = useMemo(() => linkSuggestion(people, value), [people, value]);
  const unlinked = !value.person_id && value.name.trim() !== '';

  function close() {
    setOpen(false);
    setQuery(null);
    setActive(0);
    setCreating(null);
  }

  function commit(next: PersonValue) {
    close();
    if (next.person_id !== value.person_id || next.name !== value.name) onChange(next);
  }

  function choose(option: PickerOption) {
    if (option.kind === 'person') commit({ person_id: option.person.id, name: option.person.name });
    else if (option.kind === 'free') commit({ person_id: null, name: option.text });
    else setCreating(option.text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const n = options.length;
      if (n === 0) return;
      setActive((i) => (Math.min(i, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const option = options[activeIndex];
      if (option && query !== null) choose(option);
      else if (query === null) close();
      else commit(resolveTyped(people, query, value, allowFreeText));
    } else if (e.key === 'Escape') {
      if (open || query !== null) {
        e.preventDefault();
        close();
      }
    }
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (creating !== null) {
      // Leaving the create panel cancels it, except while saving: the busy "Crear" button is
      // disabled, which drops focus (relatedTarget null) without the editor leaving.
      if (e.relatedTarget !== null) close();
      return;
    }
    if (query !== null) commit(resolveTyped(people, query, value, allowFreeText));
    else close();
  }

  const showList = open && creating === null && !disabled;
  // While typing, the hint about the stored value would describe something else: hide it.
  const hint =
    status ??
    (unlinked && query === null
      ? { text: suggestion ? 'Sin vincular · coincide con alguien del directorio' : 'Sin vincular' }
      : null);

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1" onBlur={onBlur}>
      <label htmlFor={`${id}-input`} className={hideLabel ? 'sr-only' : labelClassName}>
        {label}
      </label>
      <div className="relative">
        {value.person_id && query === null && (
          <UserRound
            aria-hidden
            size={20}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
          />
        )}
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && options[activeIndex] ? `${id}-opt-${activeIndex}` : undefined
          }
          aria-describedby={hint ? hintId : undefined}
          className={`field w-full min-w-0 ${value.person_id && query === null ? 'pl-10' : ''} ${
            value.name ? 'pr-12' : ''
          }`}
          value={text}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          maxLength={120}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {value.name && !disabled && (
          <button
            type="button"
            className="icon-btn absolute top-1/2 right-0 -translate-y-1/2"
            aria-label={`Quitar a ${value.name}`}
            onClick={() => {
              commit(EMPTY_PERSON);
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden size={20} />
          </button>
        )}
      </div>

      {hint && (
        <div id={hintId} className="flex flex-wrap items-center gap-x-2">
          <p
            className={`text-caption ${
              hint.tone === 'danger' ? 'text-danger' : status ? 'text-ink-soft' : 'text-warn'
            }`}
          >
            {hint.text}
          </p>
          {!status && suggestion && !disabled && (
            <button
              type="button"
              className="inline-flex min-h-touch items-center gap-1 text-secondary font-semibold text-ink underline underline-offset-4"
              onClick={() => commit({ person_id: suggestion.id, name: suggestion.name })}
            >
              <Link2 aria-hidden size={18} />
              Vincular con {suggestion.name}
            </button>
          )}
        </div>
      )}

      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!showList}
        className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface py-1 shadow-[var(--tk-shadow-sheet)]"
      >
        {showList && options.length === 0 && (
          <li className="px-3 py-3 text-secondary text-ink-soft">
            {directory.isPending && !peopleProp
              ? 'Cargando personas…'
              : 'Escribí un nombre para buscarlo.'}
          </li>
        )}
        {showList &&
          options.map((option, i) => (
            <li
              key={option.kind === 'person' ? option.person.id : option.kind}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex min-h-touch cursor-pointer items-center gap-3 px-3 py-2 ${
                i === activeIndex ? 'bg-[color-mix(in_srgb,var(--tk-text-primary)_8%,transparent)]' : ''
              } ${option.kind !== 'person' ? 'border-t border-line' : ''}`}
              // Keep focus in the input so the combobox stays the focus owner.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(option)}
            >
              <OptionBody option={option} selected={option.kind === 'person' && option.person.id === value.person_id} />
            </li>
          ))}
      </ul>

      {creating !== null && (
        <CreatePanel
          name={creating}
          duties={createDuties}
          onCancel={() => {
            setCreating(null);
            inputRef.current?.focus();
          }}
          onCreated={(personId, name) => {
            commit({ person_id: personId, name });
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function OptionBody({ option, selected }: { option: PickerOption; selected: boolean }) {
  if (option.kind === 'person') {
    return (
      <>
        <span className="min-w-0 flex-1">
          <span className="block text-body break-words">{option.person.name}</span>
          {option.alias && (
            <span className="block text-caption text-ink-soft break-words">
              también «{option.alias}»
            </span>
          )}
        </span>
        {selected && <Check aria-label="Elegido" size={20} className="shrink-0" />}
      </>
    );
  }
  if (option.kind === 'create') {
    return (
      <>
        <UserPlus aria-hidden size={20} className="shrink-0" />
        <span className="min-w-0 flex-1 text-body font-semibold break-words">
          Crear persona «{option.text}»
        </span>
      </>
    );
  }
  return (
    <span className="min-w-0 flex-1 text-body break-words text-ink-soft">
      Usar «{option.text}» sin vincular
    </span>
  );
}

function CreatePanel({
  name,
  duties,
  onCancel,
  onCreated,
}: {
  name: string;
  duties?: DutyRole[];
  onCancel: () => void;
  onCreated: (personId: string, name: string) => void;
}) {
  const create = useCreatePersonFromName();
  const [gender, setGender] = useState<Gender | null>(() => inferGender(name));
  const id = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  // Move focus into the panel so it is reachable from the keyboard at once.
  useEffect(() => firstRef.current?.focus(), []);

  async function save() {
    if (!gender) return;
    try {
      // mutateAsync, not mutate(…, {onSuccess}): its promise settles even if the panel unmounts.
      const personId = await create.mutateAsync({ name, gender, duties });
      onCreated(personId, name);
    } catch {
      // Shown below from create.error.
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-h`}
      className="absolute top-full right-0 left-0 z-30 mt-1 flex flex-col gap-3 rounded-md border border-line bg-surface p-3 shadow-[var(--tk-shadow-sheet)]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <p id={`${id}-h`} className="text-body font-semibold break-words">
        Crear persona «{name}»
      </p>
      <div role="radiogroup" aria-label="Género" className="grid grid-cols-2 gap-2">
        {(['M', 'F'] as const).map((g, i) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={gender === g}
            ref={i === 0 ? firstRef : undefined}
            className={gender === g ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setGender(g)}
          >
            {g === 'M' ? 'Varón' : 'Mujer'}
          </button>
        ))}
      </div>
      {!gender && <p className="text-caption text-ink-soft">Elegí varón o mujer para crearla.</p>}
      {create.isError && (
        <p role="alert" className="text-secondary text-danger">
          {create.error instanceof DataError && create.error.isUniqueViolation
            ? 'Ese nombre ya es de una persona del directorio: buscala en la lista.'
            : 'No se pudo crear. Revisá la conexión y probá de nuevo.'}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!gender || create.isPending}
          onClick={() => void save()}
        >
          {create.isPending ? 'Creando…' : 'Crear'}
        </button>
      </div>
    </div>
  );
}
