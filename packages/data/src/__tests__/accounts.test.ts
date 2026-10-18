import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setSupabase } from '../client';
import { DataError, SchemaError } from '../errors';
import { qk } from '../query/keys';
import { accountMutations, mutationOptionsFor } from '../query/mutations';
import { createQueryClient } from '../query/policy';
import { myAssignmentsQuery } from '../query/queries';
import {
  deleteWebPushSubscription,
  linkAccount,
  listAccounts,
  myAssignments,
  myLink,
  isAllowedPushEndpoint,
  saveWebPushSubscription,
  setAccountRole,
  webPushToken,
} from '../repos/accounts';
import { PersonInsert, PersonRow, ProfileRow } from '../schemas';
import { TS, fakeSupabase, flush, type Op } from './fakeSupabase';

const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const PERSON = '00000000-0000-4000-8000-000000000401';

const assignment = (over: Record<string, unknown> = {}) => ({
  key: 'carrito:00000000-0000-4000-8000-000000000601:2026-10-13',
  kind: 'carrito',
  date: '2026-10-13',
  start_time: '08:30',
  title: 'Lugar Uno',
  place: 'Lugar Uno',
  role: null,
  detail: 'Bruno Prueba',
  ...over,
});

const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  expirationTime: null,
  keys: { p256dh: 'BFake', auth: 'fake' },
};
const tokenRow = (token: string, over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  user_id: USER,
  token,
  platform: 'web',
  updated_at: TS,
  version: 1,
  updated_by: USER,
  ...over,
});
const unique = { error: { message: 'duplicate key value', code: '23505' }, status: 409 };

describe('account RPC repos', () => {
  it('myAssignments passes the range and parses rows', async () => {
    const { client, calls } = fakeSupabase(() => ({
      data: [
        assignment(),
        assignment({
          kind: 'programa',
          key: 'programa:weekend:2026-10-17:orador',
          start_time: null,
          place: null,
          role: 'Orador',
          detail: null,
        }),
      ],
    }));
    const rows = await myAssignments(client, '2026-10-12', '2026-10-31');
    expect(calls[0]).toMatchObject({
      table: 'my_assignments',
      action: 'rpc',
      values: { p_from: '2026-10-12', p_to: '2026-10-31' },
    });
    expect(rows.map((r) => r.kind)).toEqual(['carrito', 'programa']);
  });

  it('myAssignments without dates leaves the server defaults', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [] }));
    expect(await myAssignments(client)).toEqual([]);
    expect(calls[0]?.values).toEqual({});
  });

  it('myAssignments rejects an unknown kind (SchemaError)', async () => {
    const { client } = fakeSupabase(() => ({ data: [assignment({ kind: 'otro' })] }));
    await expect(myAssignments(client)).rejects.toBeInstanceOf(SchemaError);
  });

  it('myLink: row → link, no row or null person → null', async () => {
    let data: unknown = [{ person_id: PERSON, person_name: 'Ana Prueba' }];
    const { client } = fakeSupabase(() => ({ data }));
    expect(await myLink(client)).toEqual({ person_id: PERSON, person_name: 'Ana Prueba' });
    data = [];
    expect(await myLink(client)).toBeNull();
    data = [{ person_id: null, person_name: null }];
    expect(await myLink(client)).toBeNull();
  });

  it('listAccounts parses rows; a 42501 surfaces as DataError', async () => {
    let fail = false;
    const { client } = fakeSupabase(() =>
      fail
        ? { error: { message: 'list_accounts: editor role required', code: '42501' }, status: 403 }
        : {
            data: [
              {
                user_id: USER,
                email: 'miembro@example.com',
                display_name: 'Ana',
                avatar_url: null,
                provider: 'google',
                role: 'viewer',
                person_id: PERSON,
                person_name: 'Ana Prueba',
                created_at: TS,
                can_edit_programa: false,
                can_edit_privilegios: false,
              },
            ],
          },
    );
    expect((await listAccounts(client))[0]).toMatchObject({
      user_id: USER,
      provider: 'google',
      person_id: PERSON,
    });
    fail = true;
    await expect(listAccounts(client)).rejects.toMatchObject({ name: 'DataError', code: '42501' });
  });

  it('linkAccount / setAccountRole send the contract argument names', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: null }));
    await linkAccount(client, USER, PERSON);
    await linkAccount(client, USER, null);
    await setAccountRole(client, USER, 'editor');
    expect(calls.map((c) => [c.table, c.values])).toEqual([
      ['link_account', { p_user: USER, p_person: PERSON }],
      ['link_account', { p_user: USER, p_person: null }],
      ['set_account_role', { p_user: USER, p_role: 'editor' }],
    ]);
  });
});

describe('web push subscriptions', () => {
  it('webPushToken serialises a PushSubscription via toJSON', () => {
    expect(webPushToken({ toJSON: () => sub })).toBe(JSON.stringify(sub));
    expect(webPushToken('{"endpoint":"x"}')).toBe('{"endpoint":"x"}');
  });

  it('save inserts a web device token', async () => {
    const token = JSON.stringify(sub);
    const { client, calls } = fakeSupabase(() => ({ data: tokenRow(token) }));
    const row = await saveWebPushSubscription(client, sub);
    expect(calls[0]).toMatchObject({
      table: 'device_tokens',
      action: 'insert',
      values: { token, platform: 'web' },
    });
    expect(row.token).toBe(token);
  });

  it('save refuses an endpoint outside the push-service allow-list without a request', async () => {
    for (const endpoint of [
      'https://push.example.test/abc',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.test/x',
      'https://fcm.googleapis.com@evil.test/x',
      'https://fcm.googleapis.com:8443/x',
      'https://169.254.169.254/latest',
    ]) {
      const { client, calls } = fakeSupabase(() => ({ data: null }));
      const err = await saveWebPushSubscription(client, { ...sub, endpoint }).catch((e: unknown) => e);
      expect(err, endpoint).toBeInstanceOf(DataError);
      expect((err as DataError).code).toBe('23514');
      expect(calls).toHaveLength(0);
    }
    const { client } = fakeSupabase(() => ({ data: null }));
    await expect(saveWebPushSubscription(client, 'not json')).rejects.toBeInstanceOf(DataError);
  });

  it('isAllowedPushEndpoint accepts the known push services', () => {
    expect(
      [
        'https://fcm.googleapis.com/fcm/send/abc',
        'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://web.push.apple.com/QK7abc',
        'https://wns2-par02p.notify.windows.com/w/?token=abc',
        'https://api.push.apple.com/3/device/abc',
      ].map(isAllowedPushEndpoint),
    ).toEqual([true, true, true, true, true]);
    expect(isAllowedPushEndpoint('https://push.services.mozilla.com/x')).toBe(false);
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
  });

  it('saving twice returns the existing own row on 23505', async () => {
    const token = JSON.stringify(sub);
    const { client } = fakeSupabase((op: Op) =>
      op.action === 'insert' ? unique : { data: [tokenRow(token)] },
    );
    expect((await saveWebPushSubscription(client, token)).token).toBe(token);
  });

  it('save rethrows 23505 when the token belongs to another account', async () => {
    const { client } = fakeSupabase((op: Op) => (op.action === 'insert' ? unique : { data: [] }));
    const err = await saveWebPushSubscription(client, sub).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect((err as DataError).isUniqueViolation).toBe(true);
  });

  it('delete matches own rows by endpoint even when the JSON key order differs', async () => {
    const reordered = JSON.stringify({
      keys: sub.keys,
      endpoint: sub.endpoint,
      expirationTime: null,
    });
    const other = JSON.stringify({ ...sub, endpoint: 'https://push.example.test/other' });
    const { client, calls } = fakeSupabase((op: Op) =>
      op.action === 'select'
        ? {
            data: [
              tokenRow(reordered),
              tokenRow(other, { id: '00000000-0000-4000-8000-0000000000d2' }),
            ],
          }
        : { data: null },
    );
    await deleteWebPushSubscription(client, sub);
    const deletes = calls.filter((c) => c.action === 'delete');
    expect(deletes.map((d) => d.filters)).toEqual([
      [['id', '00000000-0000-4000-8000-0000000000d1']],
    ]);
  });
});

describe('query + mutation wiring', () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = createQueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.mount();
  });
  afterEach(() => {
    qc.unmount();
    qc.clear();
    setSupabase(null);
  });

  it('my assignments live under the private auth scope', () => {
    const key = myAssignmentsQuery(USER, '2026-10-12', '2026-10-31').queryKey;
    expect(key.slice(0, 2)).toEqual([...qk.auth]);
  });

  it('linkAccount invalidates accounts, my-link and my-assignments', async () => {
    const { client } = fakeSupabase(() => ({ data: null }));
    setSupabase(client);
    const range = qk.myAssignments(OTHER, '2026-10-12', '2026-10-31');
    qc.setQueryData(qk.accounts, []);
    qc.setQueryData(qk.myLink(OTHER), null);
    qc.setQueryData(range, []);
    const opts = mutationOptionsFor(qc, accountMutations.linkAccount);
    await qc.getMutationCache().build(qc, opts).execute({ userId: OTHER, personId: PERSON });
    await flush();
    expect(qc.getQueryState(qk.accounts)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(qk.myLink(OTHER))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(range)?.isInvalidated).toBe(true);
  });

  it('an observer fetches my assignments through the installed client', async () => {
    const { client } = fakeSupabase(() => ({ data: [assignment()] }));
    setSupabase(client);
    const obs = new QueryObserver(qc, myAssignmentsQuery(USER, '2026-10-12', '2026-10-31'));
    const unsub = obs.subscribe(() => {});
    await flush();
    await flush();
    expect(obs.getCurrentResult().data?.[0]?.title).toBe('Lugar Uno');
    unsub();
  });
});

describe('schema additions', () => {
  it('people.aliases: required on rows, optional on insert', () => {
    const base = {
      id: PERSON,
      name: 'Ana Prueba',
      gender: 'F',
      target_appearances: 0,
      in_carrito: true,
      duties: [],
      updated_at: TS,
      version: 1,
      updated_by: null,
    };
    expect(PersonRow.safeParse({ ...base, aliases: ['A. Prueba'] }).success).toBe(true);
    expect(PersonRow.safeParse(base).success).toBe(false);
    expect(PersonInsert.safeParse({ name: 'Ana Prueba', gender: 'F' }).success).toBe(true);
  });

  it('profiles.person_id is optional and nullable', () => {
    const base = {
      id: USER,
      role: 'viewer',
      display_name: null,
      updated_at: TS,
      version: 1,
      updated_by: null,
    };
    expect(ProfileRow.safeParse(base).success).toBe(true);
    expect(ProfileRow.safeParse({ ...base, person_id: PERSON }).success).toBe(true);
    expect(ProfileRow.safeParse({ ...base, person_id: null }).success).toBe(true);
  });
});
