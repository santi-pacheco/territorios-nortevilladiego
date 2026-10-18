import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DirectoryPerson } from '@territorios/data';
import {
  EMPTY_PERSON,
  PersonPicker,
  linkSuggestion,
  pickerOptions,
  resolveTyped,
  type PersonValue,
} from './PersonPicker';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';

const people: DirectoryPerson[] = [
  { id: A, name: 'José Pérez', aliases: ['J. Pérez'], duties: ['sonido'], in_carrito: true },
  { id: B, name: 'Ana Prueba', aliases: [], duties: [], in_carrito: false },
  { id: C, name: 'Juan Gómez', aliases: ['Juancho'], duties: [], in_carrito: true },
];

describe('pickerOptions', () => {
  it('lists matches by word prefix, then "Crear persona" for a new name', () => {
    const opts = pickerOptions(people, 'jo pe');
    expect(opts).toEqual([
      { kind: 'person', person: people[0], alias: null },
      { kind: 'create', text: 'jo pe' },
    ]);
    expect(pickerOptions(people, 'Nuevo Nombre')).toEqual([{ kind: 'create', text: 'Nuevo Nombre' }]);
  });

  it('offers "sin vincular" only with allowFreeText, and no "Crear" for an exact match', () => {
    expect(pickerOptions(people, 'ana prueba', { allowFreeText: true }).map((o) => o.kind)).toEqual([
      'person',
      'free',
    ]);
    expect(pickerOptions(people, 'Visitante', { allowFreeText: true }).map((o) => o.kind)).toEqual([
      'create',
      'free',
    ]);
  });

  it('an empty query lists everyone and no actions', () => {
    expect(pickerOptions(people, '  ').map((o) => o.kind)).toEqual(['person', 'person', 'person']);
  });

  it('matches by alias and reports it', () => {
    expect(pickerOptions(people, 'juanch')[0]).toEqual({ kind: 'person', person: people[2], alias: 'Juancho' });
  });
});

describe('resolveTyped (leaving the field without choosing)', () => {
  const linked: PersonValue = { person_id: A, name: 'José Pérez' };

  it('links an exact single match', () => {
    expect(resolveTyped(people, 'j. perez', EMPTY_PERSON, false)).toEqual(linked);
  });
  it('blank clears', () => {
    expect(resolveTyped(people, '  ', linked, false)).toEqual(EMPTY_PERSON);
  });
  it('unknown text: free text when allowed, else keeps the old value', () => {
    expect(resolveTyped(people, 'Visitante', linked, true)).toEqual({ person_id: null, name: 'Visitante' });
    expect(resolveTyped(people, 'Visitante', linked, false)).toBe(linked);
  });
  it('the same text as the current value keeps it (and its link)', () => {
    expect(resolveTyped(people, 'josé pérez ', linked, false)).toBe(linked);
  });
});

describe('linkSuggestion (legacy names)', () => {
  it('suggests the one person a stored unlinked name names exactly', () => {
    expect(linkSuggestion(people, { person_id: null, name: 'JUAN gomez' })?.id).toBe(C);
    expect(linkSuggestion(people, { person_id: null, name: 'Juan' })).toBeNull();
    expect(linkSuggestion(people, { person_id: C, name: 'Juan Gómez' })).toBeNull();
  });
});

function render(value: PersonValue, extra: Partial<Parameters<typeof PersonPicker>[0]> = {}) {
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <PersonPicker label="Conductor" value={value} onChange={() => {}} people={people} {...extra} />
    </QueryClientProvider>,
  );
}

describe('PersonPicker markup', () => {
  it('is an ARIA combobox wired to its listbox', () => {
    const html = render(EMPTY_PERSON);
    expect(html).toMatch(/role="combobox"/);
    expect(html).toMatch(/aria-autocomplete="list"/);
    expect(html).toMatch(/aria-expanded="false"/);
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}" role="listbox"`);
    expect(html).toMatch(/<label[^>]*>Conductor<\/label>/);
  });

  it('marks an unlinked value and offers to link a legacy exact match', () => {
    const html = render({ person_id: null, name: 'Juan Gómez' });
    expect(html).toContain('Sin vincular');
    expect(html).toContain('Vincular con Juan Gómez');
  });

  it('shows no mark for a linked value, and a clear button', () => {
    const html = render({ person_id: A, name: 'José Pérez' });
    expect(html).not.toContain('Sin vincular');
    expect(html).toContain('aria-label="Quitar a José Pérez"');
  });
});
