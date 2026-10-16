import { describe, expect, it } from 'vitest';
import { ConflictError, DataError, NetworkError } from '../errors';
import { removePair } from '../repos/people';
import { deleteMeeting, fetchServiceWeek, updateMeeting } from '../repos/salidas';
import { MEETING_ID, WEEK_START, fakeSupabase, meetingRow, weekRow } from './fakeSupabase';

describe('CAS update', () => {
  it('filters on id + expected version and never sends server-owned columns', async () => {
    const { client, calls } = fakeSupabase((op) =>
      op.action === 'update'
        ? { data: meetingRow({ conductor: 'Nuevo', version: 3 }) }
        : { data: null },
    );
    const patch = { conductor: 'Nuevo', version: 99, updated_by: 'x' } as unknown as {
      conductor: string;
    };

    const row = await updateMeeting(client, MEETING_ID, 2, patch);

    expect(row.version).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual({ conductor: 'Nuevo' });
    expect(calls[0]?.filters).toEqual([
      ['id', MEETING_ID],
      ['version', 2],
    ]);
  });

  it('0 rows ⇒ refetches the current row and throws ConflictError', async () => {
    const { client, calls } = fakeSupabase((op) =>
      op.action === 'update'
        ? { data: null }
        : { data: meetingRow({ conductor: 'Otro', version: 3 }) },
    );

    const err = await updateMeeting(client, MEETING_ID, 2, { conductor: 'Mío' }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ConflictError);
    const c = err as ConflictError<{ version: number; conductor: string }>;
    expect(c.table).toBe('service_meetings');
    expect(c.id).toBe(MEETING_ID);
    expect(c.expectedVersion).toBe(2);
    expect(c.current?.version).toBe(3);
    expect(c.current?.conductor).toBe('Otro');
    expect(c.deleted).toBe(false);
    expect(c.likelyPermissionDenied).toBe(false);
    expect(calls.map((o) => o.action)).toEqual(['update', 'select']);
    expect(calls[1]?.filters).toEqual([['id', MEETING_ID]]);
  });

  it('distinguishes a deleted row and an RLS denial (row unchanged at expected version)', async () => {
    const deleted = fakeSupabase(() => ({ data: null }));
    const e1 = (await updateMeeting(deleted.client, MEETING_ID, 2, { place: 'x' }).catch(
      (e) => e,
    )) as ConflictError;
    expect(e1.current).toBeNull();
    expect(e1.deleted).toBe(true);

    const denied = fakeSupabase((op) =>
      op.action === 'update' ? { data: null } : { data: meetingRow({ version: 2 }) },
    );
    const e2 = (await updateMeeting(denied.client, MEETING_ID, 2, { place: 'x' }).catch(
      (e) => e,
    )) as ConflictError;
    expect(e2.likelyPermissionDenied).toBe(true);
  });

  it('CAS delete uses the same guard', async () => {
    const ok = fakeSupabase(() => ({ data: meetingRow() }));
    await expect(deleteMeeting(ok.client, MEETING_ID, 1)).resolves.toBeUndefined();
    expect(ok.calls[0]?.filters).toEqual([
      ['id', MEETING_ID],
      ['version', 1],
    ]);

    const stale = fakeSupabase((op) =>
      op.action === 'delete' ? { data: null } : { data: meetingRow({ version: 4 }) },
    );
    await expect(deleteMeeting(stale.client, MEETING_ID, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it('composite keys: removePair normalises order and reports the key in the conflict', async () => {
    const a = '00000000-0000-4000-8000-00000000000a';
    const b = '00000000-0000-4000-8000-00000000000b';
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    const err = (await removePair(client, { person_a: b, person_b: a }, 1).catch(
      (e) => e,
    )) as ConflictError;
    expect(calls[0]?.filters).toEqual([
      ['person_a', a],
      ['person_b', b],
      ['version', 1],
    ]);
    expect(err.id).toEqual({ person_a: a, person_b: b });
  });

  it('rejects invalid patches client-side (kind/dow invariant)', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    await expect(
      updateMeeting(client, MEETING_ID, 1, { kind: 'domingo', dow: 3 }),
    ).rejects.toBeInstanceOf(DataError);
    expect(calls).toHaveLength(0);
  });
});

describe('error mapping', () => {
  it('status 0 (fetch failed) ⇒ NetworkError; aborts and PostgREST errors ⇒ DataError', async () => {
    const offline = fakeSupabase(() => ({
      error: { message: 'TypeError: Failed to fetch', code: '' },
      status: 0,
    }));
    await expect(fetchServiceWeek(offline.client, WEEK_START)).rejects.toBeInstanceOf(NetworkError);

    const aborted = fakeSupabase(() => ({
      error: { message: 'AbortError: aborted', code: '' },
      status: 0,
    }));
    await expect(fetchServiceWeek(aborted.client, WEEK_START)).rejects.toBeInstanceOf(DataError);

    const dup = fakeSupabase(() => ({
      error: { message: 'duplicate key', code: '23505' },
      status: 409,
    }));
    const err = (await fetchServiceWeek(dup.client, WEEK_START).catch((e) => e)) as DataError;
    expect(err).toBeInstanceOf(DataError);
    expect(err.isUniqueViolation).toBe(true);
  });
});

describe('fetchServiceWeek', () => {
  it('splits the embedded meetings, parses and sorts them', async () => {
    const m1 = meetingRow({ id: '00000000-0000-4000-8000-000000000010', dow: 5 });
    const m0 = meetingRow({
      id: '00000000-0000-4000-8000-000000000011',
      dow: 0,
      kind: 'domingo',
      group_territories: { G1: [1] },
    });
    const { client } = fakeSupabase(() => ({ data: { ...weekRow(), service_meetings: [m1, m0] } }));
    const res = await fetchServiceWeek(client, WEEK_START);
    expect(res.week?.week_start).toBe(WEEK_START);
    expect(res.meetings.map((m) => m.dow)).toEqual([0, 5]);
  });

  it('returns an empty week when none exists', async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    await expect(fetchServiceWeek(client, WEEK_START)).resolves.toEqual({
      week: null,
      meetings: [],
    });
  });
});
