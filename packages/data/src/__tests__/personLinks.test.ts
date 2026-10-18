import { describe, expect, it } from 'vitest';
import { SchemaError } from '../errors';
import { isPrivateKey, qk } from '../query/keys';
import { createPersonFromName, fetchPeopleDirectory } from '../repos/people';
import { saveProgramWeek } from '../repos/program';
import { updateMeeting } from '../repos/salidas';
import { exactPeople, normName, searchPeople, uniquePerson } from '../peopleSearch';
import { ProgramWeekInsert, ProgramWeekUpdate, ServiceMeetingRow } from '../schemas';
import { MEETING_ID, TS, fakeSupabase, meetingRow } from './fakeSupabase';

const P1 = '00000000-0000-4000-8000-000000000501';
const P2 = '00000000-0000-4000-8000-000000000502';
const P3 = '00000000-0000-4000-8000-000000000503';

const dir = [
  { id: P1, name: 'José Pérez', aliases: ['J. Pérez'], duties: ['sonido' as const], in_carrito: true },
  { id: P2, name: 'Ana María López', aliases: [], duties: [], in_carrito: false },
  { id: P3, name: 'Juan Gómez', aliases: ['Juancho'], duties: [], in_carrito: true },
];

describe('people_directory', () => {
  it('calls the RPC and parses the rows', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: dir }));
    const rows = await fetchPeopleDirectory(client);
    expect(calls[0]).toMatchObject({ table: 'people_directory', action: 'rpc' });
    expect(rows.map((r) => r.name)).toEqual(['José Pérez', 'Ana María López', 'Juan Gómez']);
  });

  it('rejects a malformed row', async () => {
    const { client } = fakeSupabase(() => ({ data: [{ id: P1, name: 'X' }] }));
    await expect(fetchPeopleDirectory(client)).rejects.toBeInstanceOf(SchemaError);
  });

  it('lives under the private directory scope (never persisted)', () => {
    expect(isPrivateKey(qk.peopleDirectory)).toBe(true);
  });

  it('createPersonFromName sends the duties', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: P3 }));
    await createPersonFromName(client, 'Nuevo Ejemplo', 'M', false, ['acomodador']);
    expect(calls[0]?.values).toEqual({
      p_name: 'Nuevo Ejemplo',
      p_gender: 'M',
      p_in_carrito: false,
      p_duties: ['acomodador'],
    });
  });
});

describe('peopleSearch', () => {
  it('normName mirrors private.norm_name', () => {
    expect(normName('  José   PÉREZ ')).toBe('jose perez');
  });

  it('matches word prefixes of the name, accent and case-insensitively', () => {
    expect(searchPeople(dir, 'jo pe').map((h) => h.person.id)).toEqual([P1]);
    expect(searchPeople(dir, 'MARIA').map((h) => h.person.id)).toEqual([P2]);
    expect(searchPeople(dir, 'lop an').map((h) => h.person.id)).toEqual([P2]);
    expect(searchPeople(dir, 'pe pe')).toEqual([]);
  });

  it('falls back to aliases and reports which alias matched', () => {
    expect(searchPeople(dir, 'juanch')).toEqual([{ person: dir[2], alias: 'Juancho' }]);
  });

  it('lists name matches before alias matches; empty query = everyone by name', () => {
    expect(searchPeople(dir, 'j').map((h) => h.person.id)).toEqual([P1, P3]);
    expect(searchPeople(dir, ' ').map((h) => h.person.name)).toEqual([
      'Ana María López',
      'José Pérez',
      'Juan Gómez',
    ]);
  });

  it('exact match by name or alias', () => {
    expect(exactPeople(dir, 'j. perez').map((p) => p.id)).toEqual([P1]);
    expect(uniquePerson(dir, 'JUAN gomez')?.id).toBe(P3);
    expect(uniquePerson(dir, 'Juan')).toBeNull();
    expect(uniquePerson([...dir, { ...dir[0]!, id: P2 }], 'José Pérez')).toBeNull();
  });
});

describe('service_meetings.conductor_person_id', () => {
  it('rows parse with and without the column (pre-migration)', () => {
    expect(ServiceMeetingRow.parse(meetingRow({ conductor_person_id: P1 })).conductor_person_id).toBe(P1);
    expect(ServiceMeetingRow.parse(meetingRow()).conductor_person_id).toBeUndefined();
  });

  it('conductor and its link go in one CAS patch', async () => {
    const { client, calls } = fakeSupabase(() => ({
      data: meetingRow({ conductor: 'José Pérez', conductor_person_id: P1, version: 3 }),
    }));
    await updateMeeting(client, MEETING_ID, 2, { conductor: 'José Pérez', conductor_person_id: P1 });
    expect(calls[0]?.values).toEqual({ conductor: 'José Pérez', conductor_person_id: P1 });
  });
});

describe('program person shapes', () => {
  const tuesday = '2026-10-13';
  const saturday = '2026-10-17';

  it('accepts legacy strings and linked objects', () => {
    expect(
      ProgramWeekInsert.safeParse({
        kind: 'weekend',
        date: saturday,
        data: {
          presidente: 'Juan Gómez',
          lector: { name: 'José Pérez', person_id: P1 },
          conductor: null,
          discurso: { titulo: 'x', orador: { name: 'Visitante' } },
        },
      }).success,
    ).toBe(true);
    expect(
      ProgramWeekUpdate.safeParse({
        data: { parts: [{ title: 'Lectura', people: [{ name: 'José', role: 'Lector', person_id: P1 }] }] },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed people on write', () => {
    expect(
      ProgramWeekUpdate.safeParse({ data: { lector: { name: 'José', person_id: 'nope' } } }).success,
    ).toBe(false);
    expect(ProgramWeekUpdate.safeParse({ data: { presidente: 3 } }).success).toBe(false);
    expect(
      ProgramWeekUpdate.safeParse({ data: { discurso: { orador: { person_id: P1 } } } }).success,
    ).toBe(false);
    expect(
      ProgramWeekUpdate.safeParse({ data: { parts: [{ title: 'x', people: ['José'] }] } }).success,
    ).toBe(false);
  });

  it('saveProgramWeek sends person_id through', async () => {
    const row = { id: P2, kind: 'midweek', date: tuesday, data: {}, updated_at: TS, version: 1, updated_by: null };
    const { client, calls } = fakeSupabase(() => ({ data: row }));
    const data = { parts: [{ title: 'Lectura', people: [{ name: 'José Pérez', person_id: P1 }] }] };
    await saveProgramWeek(client, 'midweek', tuesday, data, 1);
    expect(calls[0]?.values).toEqual({ data });
  });
});
