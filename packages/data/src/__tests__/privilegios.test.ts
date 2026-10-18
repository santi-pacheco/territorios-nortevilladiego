import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSupabase } from '../client';
import { ConflictError, DataError, SchemaError } from '../errors';
import { isPrivateKey, qk, tableScopes } from '../query/keys';
import { mutationOptionsFor, privilegiosMutations } from '../query/mutations';
import { createQueryClient } from '../query/policy';
import { myPermissions, setAccountPermissions } from '../repos/accounts';
import {
  addPersonAlias,
  carritoPeople,
  createPersonFromName,
  fetchDutyPeople,
  fetchNameSources,
  type PeopleRoster,
} from '../repos/people';
import type { DutyRoster } from '../repos/privilegios';
import {
  clearDutyCell,
  clearDutyDay,
  fetchDutyRoster,
  setDutyDay,
  upsertDutyCell,
} from '../repos/privilegios';
import { fetchProgramWeeks, saveProgramWeek } from '../repos/program';
import { DutyCellInput, MyAssignment, PersonRow } from '../schemas';
import { TS, deferred, fakeSupabase, flush } from './fakeSupabase';

const P1 = '00000000-0000-4000-8000-000000000401';
const P2 = '00000000-0000-4000-8000-000000000402';
const P3 = '00000000-0000-4000-8000-000000000406';
const USER = '00000000-0000-4000-8000-0000000000a1';
const SLOT = '00000000-0000-4000-8000-000000000301';
const meta = { updated_at: TS, version: 1, updated_by: null };

const person = (id: string, over: Record<string, unknown> = {}) =>
  PersonRow.parse({
    id,
    name: `Persona ${id.slice(-3)}`,
    gender: 'M',
    target_appearances: 0,
    aliases: [],
    in_carrito: true,
    duties: [],
    ...meta,
    ...over,
  });

const cell = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000701',
  date: '2026-10-13',
  role: 'sonido',
  slot: 1,
  person_id: P2,
  person_name: 'Bruno Prueba',
  note: null,
  ...meta,
  ...over,
});
const day = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-24',
  kind: 'asamblea',
  note: 'Asamblea de circuito',
  ...meta,
  ...over,
});
const unique = { error: { message: 'duplicate key value', code: '23505' }, status: 409 };

describe('carritoPeople', () => {
  it('keeps only in_carrito people, their availability and pairs fully inside the carrito', () => {
    const roster: PeopleRoster = {
      people: [person(P1), person(P2), person(P3, { in_carrito: false })],
      availability: [
        { person_id: P1, slot_id: SLOT, ...meta },
        { person_id: P3, slot_id: SLOT, ...meta },
      ],
      pairs: [
        { person_a: P1, person_b: P2, ...meta },
        { person_a: P2, person_b: P3, ...meta },
      ],
    };
    const out = carritoPeople(roster);
    expect(out.people.map((p) => p.id)).toEqual([P1, P2]);
    expect(out.availability.map((a) => a.person_id)).toEqual([P1]);
    expect(out.pairs).toEqual([{ person_a: P1, person_b: P2, ...meta }]);
  });
});

describe('people directory RPCs', () => {
  it('fetchNameSources parses rows (unmatched person null)', async () => {
    const { client, calls } = fakeSupabase(() => ({
      data: [
        {
          name: 'Hermano Prueba',
          norm: 'hermano prueba',
          sources: ['programa', 'salida'],
          uses: 3,
          first_date: '2026-10-13',
          last_date: '2026-10-17',
          person_id: null,
          person_name: null,
        },
      ],
    }));
    const rows = await fetchNameSources(client);
    expect(calls[0]).toMatchObject({ table: 'name_sources', action: 'rpc' });
    expect(rows[0]).toMatchObject({ uses: 3, person_id: null, sources: ['programa', 'salida'] });
  });

  it('fetchNameSources rejects an unknown source (SchemaError)', async () => {
    const { client } = fakeSupabase(() => ({
      data: [
        {
          name: 'X',
          norm: 'x',
          sources: ['carrito'],
          uses: 1,
          first_date: null,
          last_date: null,
          person_id: null,
          person_name: null,
        },
      ],
    }));
    await expect(fetchNameSources(client)).rejects.toBeInstanceOf(SchemaError);
  });

  it('createPersonFromName / addPersonAlias / duty_people send the contract argument names', async () => {
    const { client, calls } = fakeSupabase((op) => {
      if (op.table === 'create_person_from_name') return { data: P3 };
      if (op.table === 'duty_people')
        return { data: [{ id: P2, name: 'Bruno Prueba', duties: ['sonido'], aliases: [] }] };
      return { data: null };
    });
    expect(await createPersonFromName(client, 'Hermano Ejemplo', 'M')).toBe(P3);
    await createPersonFromName(client, 'Hermana Ejemplo', 'F', true);
    await addPersonAlias(client, P2, 'B. Prueba');
    expect((await fetchDutyPeople(client))[0]?.duties).toEqual(['sonido']);
    expect(calls.map((c) => [c.table, c.values])).toEqual([
      [
        'create_person_from_name',
        { p_name: 'Hermano Ejemplo', p_gender: 'M', p_in_carrito: false, p_duties: [] },
      ],
      [
        'create_person_from_name',
        { p_name: 'Hermana Ejemplo', p_gender: 'F', p_in_carrito: true, p_duties: [] },
      ],
      ['add_person_alias', { p_person: P2, p_alias: 'B. Prueba' }],
      ['duty_people', undefined],
    ]);
  });

  it('a duplicate name surfaces as a 23505 DataError', async () => {
    const { client } = fakeSupabase(() => unique);
    const err = await createPersonFromName(client, 'Ana Prueba', 'F').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).isUniqueViolation).toBe(true);
  });
});

describe('permissions RPCs', () => {
  it('myPermissions parses the single row; no row ⇒ viewer with everything false', async () => {
    let data: unknown = [
      {
        role: 'viewer',
        can_edit_programa: false,
        can_edit_privilegios: true,
        sees_privilegios: true,
      },
    ];
    const { client } = fakeSupabase(() => ({ data }));
    expect(await myPermissions(client)).toMatchObject({ can_edit_privilegios: true });
    data = [];
    expect(await myPermissions(client)).toEqual({
      role: 'viewer',
      can_edit_programa: false,
      can_edit_privilegios: false,
      sees_privilegios: false,
    });
  });

  it('setAccountPermissions sends p_user/p_programa/p_privilegios (null = unchanged)', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    await setAccountPermissions(client, USER, true, null);
    expect(calls[0]).toMatchObject({
      table: 'set_account_permissions',
      values: { p_user: USER, p_programa: true, p_privilegios: null },
    });
  });

  it('MyAssignment accepts kind privilegio', () => {
    expect(
      MyAssignment.safeParse({
        key: 'privilegio:2026-10-13:sonido:1',
        kind: 'privilegio',
        date: '2026-10-13',
        start_time: null,
        title: 'Sonido',
        place: null,
        role: null,
        detail: null,
      }).success,
    ).toBe(true);
  });
});

describe('duty roster repo', () => {
  it('fetchDutyRoster reads rows and days in the range', async () => {
    const { client, calls } = fakeSupabase((op) => ({
      data: op.table === 'duty_roster' ? [cell()] : [day()],
    }));
    const r = await fetchDutyRoster(client, '2026-10-01', '2026-10-31');
    expect(r.rows).toHaveLength(1);
    expect(r.days[0]?.kind).toBe('asamblea');
    for (const c of calls) {
      expect(c.filters).toEqual([
        ['date>=', '2026-10-01'],
        ['date<=', '2026-10-31'],
      ]);
    }
  });

  it('upsertDutyCell without version inserts the cell', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: cell() }));
    await upsertDutyCell(client, {
      date: '2026-10-13',
      role: 'sonido',
      slot: 1,
      person_id: P2,
      person_name: null,
    });
    expect(calls[0]).toMatchObject({
      table: 'duty_roster',
      action: 'insert',
      values: { date: '2026-10-13', role: 'sonido', slot: 1, person_id: P2, person_name: null },
    });
  });

  it('an insert that loses the race becomes a ConflictError carrying the winning row', async () => {
    const { client, calls } = fakeSupabase((op) =>
      op.action === 'insert' ? unique : { data: cell({ version: 2 }) },
    );
    const err = await upsertDutyCell(client, {
      date: '2026-10-13',
      role: 'sonido',
      slot: 1,
      person_id: null,
      person_name: 'Hermano Libre',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).expectedVersion).toBe(0);
    expect((err as ConflictError).current).toMatchObject({ version: 2 });
    expect(calls[1]?.filters).toEqual([
      ['date', '2026-10-13'],
      ['role', 'sonido'],
      ['slot', 1],
    ]);
  });

  it('upsertDutyCell with version is a CAS update on (date, role, slot)', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: cell({ version: 3 }) }));
    await upsertDutyCell(
      client,
      { date: '2026-10-13', role: 'sonido', slot: 1, person_id: P1, person_name: null },
      2,
    );
    expect(calls[0]).toMatchObject({
      action: 'update',
      values: { person_id: P1, person_name: null },
      filters: [
        ['date', '2026-10-13'],
        ['role', 'sonido'],
        ['slot', 1],
        ['version', 2],
      ],
    });
  });

  it('a cell needs a person or a name (client validation, nothing sent)', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    expect(
      DutyCellInput.safeParse({
        date: '2026-10-13',
        role: 'sonido',
        slot: 1,
        person_id: null,
        person_name: '  ',
      }).success,
    ).toBe(false);
    await expect(
      upsertDutyCell(client, {
        date: '2026-10-13',
        role: 'sonido',
        slot: 5,
        person_id: P1,
        person_name: null,
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_VALIDATION' });
    expect(calls).toHaveLength(0);
  });

  it('clearDutyCell / setDutyDay / clearDutyDay use CAS on their natural keys', async () => {
    const { client, calls } = fakeSupabase((op) => ({
      data: op.table === 'duty_days' ? day() : cell(),
    }));
    await clearDutyCell(client, { date: '2026-10-13', role: 'sonido', slot: 1 }, 1);
    await setDutyDay(client, { date: '2026-10-24', kind: 'asamblea', note: null });
    await setDutyDay(client, { date: '2026-10-24', kind: 'sin_reunion' }, 1);
    await clearDutyDay(client, '2026-10-24', 2);
    expect(calls.map((c) => [c.table, c.action, c.values, c.filters])).toEqual([
      [
        'duty_roster',
        'delete',
        undefined,
        [
          ['date', '2026-10-13'],
          ['role', 'sonido'],
          ['slot', 1],
          ['version', 1],
        ],
      ],
      ['duty_days', 'insert', { date: '2026-10-24', kind: 'asamblea', note: null }, []],
      [
        'duty_days',
        'update',
        { kind: 'sin_reunion' },
        [
          ['date', '2026-10-24'],
          ['version', 1],
        ],
      ],
      [
        'duty_days',
        'delete',
        undefined,
        [
          ['date', '2026-10-24'],
          ['version', 2],
        ],
      ],
    ]);
  });
});

describe('program editor repo', () => {
  const programRow = (over: Record<string, unknown> = {}) => ({
    id: '00000000-0000-4000-8000-000000000801',
    kind: 'midweek',
    date: '2026-10-13',
    data: { parts: [] },
    ...meta,
    ...over,
  });

  it('fetchProgramWeeks reads a date range', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [programRow()] }));
    expect(await fetchProgramWeeks(client, '2026-10-01', '2026-10-31')).toHaveLength(1);
    expect(calls[0]?.filters).toEqual([
      ['date>=', '2026-10-01'],
      ['date<=', '2026-10-31'],
    ]);
  });

  it('saveProgramWeek inserts without a version and CAS-updates (kind, date) with one', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: programRow() }));
    await saveProgramWeek(client, 'midweek', '2026-10-13', { parts: [] });
    await saveProgramWeek(client, 'midweek', '2026-10-13', { parts: [{ title: 'x' }] }, 4);
    expect(calls[0]).toMatchObject({
      action: 'insert',
      values: { kind: 'midweek', date: '2026-10-13', data: { parts: [] } },
    });
    expect(calls[1]).toMatchObject({
      action: 'update',
      values: { data: { parts: [{ title: 'x' }] } },
      filters: [
        ['kind', 'midweek'],
        ['date', '2026-10-13'],
        ['version', 4],
      ],
    });
  });

  it('saveProgramWeek rejects a midweek date that is not a Tuesday', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    await expect(saveProgramWeek(client, 'midweek', '2026-10-14', {})).rejects.toMatchObject({
      code: 'CLIENT_VALIDATION',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('keys and mutations', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = createQueryClient();
  });
  afterEach(() => {
    qc.clear();
    setSupabase(null);
  });

  it('directory, privilegios and permissions are private (never persisted)', () => {
    expect(isPrivateKey(qk.nameSources)).toBe(true);
    expect(isPrivateKey(qk.dutyRoster('2026-10-01', '2026-10-31'))).toBe(true);
    expect(isPrivateKey(qk.dutyPeople)).toBe(true);
    expect(isPrivateKey(qk.myPermissions(USER))).toBe(true);
    expect(isPrivateKey(qk.programRange('2026-10-01', '2026-10-31'))).toBe(false);
  });

  it('roster changes refresh Mis asignaciones', () => {
    expect(tableScopes.duty_roster).toContainEqual(qk.myAssignmentsAll);
    expect(tableScopes.duty_days).toContainEqual(qk.myAssignmentsAll);
  });

  it('clearDutyCell drops the cell optimistically and rolls back on conflict', async () => {
    const gate = deferred<{ data: unknown }>();
    const { client } = fakeSupabase((op) =>
      op.action === 'delete' ? gate.promise : { data: cell({ version: 2 }) },
    );
    setSupabase(client);
    const key = qk.dutyRoster('2026-10-01', '2026-10-31');
    const before: DutyRoster = { rows: [cell() as DutyRoster['rows'][number]], days: [] };
    qc.setQueryData(key, before);

    const opts = mutationOptionsFor(qc, privilegiosMutations.clearDutyCell);
    const run = qc
      .getMutationCache()
      .build(qc, opts)
      .execute({ date: '2026-10-13', role: 'sonido', slot: 1, version: 1 })
      .catch((e: unknown) => e);
    await flush();
    expect(qc.getQueryData<DutyRoster>(key)?.rows).toEqual([]);

    gate.resolve({ data: null });
    expect(await run).toBeInstanceOf(ConflictError);
    expect(qc.getQueryData<DutyRoster>(key)).toEqual(before);
  });
});
