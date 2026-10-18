// deno test --config supabase/functions/workbook/deno.json supabase/functions/workbook
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.13';
import {
  allowedHost,
  bearerToken,
  FetchGuardError,
  guardedFetch,
  inWorkbookRange,
  rpcErrorStatus,
  userErrorStatus,
} from './guard.ts';

const EPUB = 'https://cfp2.jw-cdn.org/a/x/1/o/mwb_S_202609.epub';

/** A fetch stand-in answering from a table of url → Response factories. Records each call. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; redirect?: RequestRedirect }> = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, redirect: init?.redirect });
    const r = routes[url];
    return Promise.resolve(r ? r() : new Response('nope', { status: 404 }));
  }) as typeof fetch;
  return { impl, calls };
}

const redirect = (to: string, status = 302) => () =>
  new Response(null, { status, headers: { location: to } });

Deno.test('allowedHost: https *.jw-cdn.org only', () => {
  assertEquals(allowedHost(EPUB), true);
  assertEquals(allowedHost('https://jw-cdn.org/x'), true);
  for (const bad of [
    'http://cfp2.jw-cdn.org/x',
    'https://jw-cdn.org.evil.test/x',
    'https://eviljw-cdn.org/x',
    'https://cfp2.jw-cdn.org@evil.test/x',
    'https://cfp2.jw-cdn.org:8443/x',
    'https://169.254.169.254/x',
    'not a url',
  ]) {
    assertEquals(allowedHost(bad), false, bad);
  }
});

Deno.test('guardedFetch: reads the body, never lets fetch follow redirects itself', async () => {
  const f = fakeFetch({ [EPUB]: () => new Response(new Uint8Array([1, 2, 3])) });
  const r = await guardedFetch(EPUB, { maxBytes: 10, fetchImpl: f.impl });
  assertEquals([...r.body], [1, 2, 3]);
  assertEquals(f.calls, [{ url: EPUB, redirect: 'manual' }]);
});

Deno.test('guardedFetch: follows a redirect to jw-cdn, refuses one off-domain', async () => {
  const next = 'https://cfp3.jw-cdn.org/b.epub';
  const ok = fakeFetch({ [EPUB]: redirect('/b.epub'), 'https://cfp2.jw-cdn.org/b.epub': redirect(next), [next]: () => new Response('x') });
  assertEquals((await guardedFetch(EPUB, { maxBytes: 10, fetchImpl: ok.impl })).body.length, 1);
  assertEquals(ok.calls.length, 3);

  const off = fakeFetch({ [EPUB]: redirect('http://169.254.169.254/latest/meta-data') });
  await assertRejects(() => guardedFetch(EPUB, { maxBytes: 10, fetchImpl: off.impl }), FetchGuardError, 'host not allowed');
  assertEquals(off.calls.length, 1);

  const loop = fakeFetch({ [EPUB]: redirect(EPUB) });
  await assertRejects(() => guardedFetch(EPUB, { maxBytes: 10, fetchImpl: loop.impl }), FetchGuardError, 'redirect refused');
  assertEquals(loop.calls.length, 3);
});

Deno.test('guardedFetch: refuses a disallowed start URL without fetching', async () => {
  const f = fakeFetch({});
  await assertRejects(() => guardedFetch('https://example.test/x', { maxBytes: 10, fetchImpl: f.impl }), FetchGuardError);
  assertEquals(f.calls.length, 0);
});

Deno.test('guardedFetch: size cap by Content-Length and by counted bytes', async () => {
  const declared = fakeFetch({
    [EPUB]: () => new Response('tiny', { headers: { 'content-length': '999999999' } }),
  });
  await assertRejects(() => guardedFetch(EPUB, { maxBytes: 100, fetchImpl: declared.impl }), FetchGuardError, 'too large');

  // No Content-Length: a stream that keeps going is cut at the cap.
  const stream = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(64));
        },
      }),
    );
  const endless = fakeFetch({ [EPUB]: stream });
  await assertRejects(() => guardedFetch(EPUB, { maxBytes: 1000, fetchImpl: endless.impl }), FetchGuardError, 'too large');
});

Deno.test('guardedFetch: non-2xx throws with the status', async () => {
  const f = fakeFetch({ [EPUB]: () => new Response('gone', { status: 404 }) });
  const err = await assertRejects(() => guardedFetch(EPUB, { maxBytes: 10, fetchImpl: f.impl }), FetchGuardError);
  assertEquals((err as unknown as { status: number }).status, 404);
});

Deno.test('guardedFetch: times out', async () => {
  // Never answers on its own; rejects only when the signal guardedFetch passes aborts.
  const hang = ((_: unknown, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as typeof fetch;
  const err = await assertRejects(() => guardedFetch(EPUB, { maxBytes: 10, timeoutMs: 10, fetchImpl: hang }));
  assertEquals((err as DOMException).name, 'TimeoutError');
});

Deno.test('bearerToken', () => {
  assertEquals(bearerToken('Bearer abc.def'), 'abc.def');
  assertEquals(bearerToken('bearer   abc'), 'abc');
  assertEquals(bearerToken('Basic abc'), null);
  assertEquals(bearerToken('Bearer '), null);
  assertEquals(bearerToken(null), null);
});

Deno.test('auth errors map to 401/403, real failures to null (500)', () => {
  // getUser: publishable key / anon JWT / expired token → 4xx from Auth.
  assertEquals([401, 403, 400, 422, 500, 0, undefined].map((status) => userErrorStatus({ status })), [
    401, 401, 401, 401, null, null, null,
  ]);
  assertEquals(rpcErrorStatus({ code: '42501', status: 401 }), 403);
  assertEquals(rpcErrorStatus({ code: 'PGRST301', status: 401 }), 401);
  assertEquals(rpcErrorStatus({ code: 'PGRST303' }), 401);
  assertEquals(rpcErrorStatus({ status: 401 }), 401);
  assertEquals(rpcErrorStatus({ status: 403 }), 403);
  assertEquals(rpcErrorStatus({ code: 'PGRST202', status: 404 }), null);
  assertEquals(rpcErrorStatus({ code: '57014', status: 500 }), null);
});

Deno.test('inWorkbookRange: 2020-2100', () => {
  assertEquals(['2019-12-30', '2020-01-06', '2026-10', '2100-12', '9999-01'].map(inWorkbookRange), [
    false, true, true, true, false,
  ]);
});
