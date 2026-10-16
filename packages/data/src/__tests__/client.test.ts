import { afterEach, describe, expect, it } from 'vitest';
import { db, setSupabase, withDb } from '../client';
import { fakeSupabase } from './fakeSupabase';

afterEach(() => setSupabase(null));

describe('withDb', () => {
  it('rejects when no client was registered (build without credentials)', async () => {
    await expect(withDb(async () => 1)).rejects.toThrow(/not initialised/);
    expect(() => db()).toThrow(/not initialised/);
  });

  it('waits for a loading client, then runs synchronously once it is ready', async () => {
    const { client } = fakeSupabase(() => ({}));
    let resolve!: (c: typeof client) => void;
    setSupabase(new Promise<typeof client>((r) => (resolve = r)));
    expect(() => db()).toThrow(/not initialised/);
    const pending = withDb(async (sb) => sb);
    resolve(client);
    await expect(pending).resolves.toBe(client);
    expect(db()).toBe(client);
    let ranSync = false;
    void withDb(async () => {
      ranSync = true;
    });
    expect(ranSync).toBe(true);
  });

  it('a later setSupabase wins over a client still loading', async () => {
    const a = fakeSupabase(() => ({})).client;
    const b = fakeSupabase(() => ({})).client;
    let resolve!: (c: typeof a) => void;
    const loading = new Promise<typeof a>((r) => (resolve = r));
    setSupabase(loading);
    setSupabase(b);
    resolve(a);
    await loading;
    await Promise.resolve();
    expect(db()).toBe(b);
  });
});
