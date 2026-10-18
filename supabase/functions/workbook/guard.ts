/**
 * Request guards for the `workbook` function: auth error → HTTP status mapping, the jw-cdn
 * host allow-list, and a fetch with a timeout, checked redirects and a byte cap.
 * No Deno globals, so `deno test` covers it with a fake fetch.
 */

/** Only these hosts are fetched (the issue list and the EPUB files). */
export function allowedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      u.username === '' &&
      u.password === '' &&
      u.port === '' &&
      (u.hostname === 'jw-cdn.org' || u.hostname.endsWith('.jw-cdn.org'))
    );
  } catch {
    return false;
  }
}

export const MAX_EPUB_BYTES = 25 * 1024 * 1024;
export const MAX_META_BYTES = 1024 * 1024;
/** Uncompressed size of one week file inside the EPUB (zip-bomb guard). */
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 2;

export class FetchGuardError extends Error {}

export interface GuardedFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * GET `url` and return its body. Redirects are followed by hand, at most twice, and only to
 * allowed hosts; the body is read as a stream and refused past `maxBytes`, whatever
 * Content-Length says. Non-2xx answers throw a FetchGuardError carrying `status`.
 */
export async function guardedFetch(
  url: string,
  opts: GuardedFetchOptions,
): Promise<{ status: number; body: Uint8Array }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; ; hop++) {
    if (!allowedHost(current)) throw new FetchGuardError(`host not allowed: ${new URL(current).host}`);
    const res = await doFetch(current, { redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new FetchGuardError(`redirect refused (${res.status})`);
      current = new URL(location, current).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw Object.assign(new FetchGuardError(`HTTP ${res.status}`), { status: res.status });
    }
    return { status: res.status, body: await readCapped(res, opts.maxBytes) };
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw new FetchGuardError(`too large: ${declared} bytes`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchGuardError(`too large: over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** `Authorization: Bearer <token>` → token, else null. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return m?.[1] ?? null;
}

/**
 * auth.getUser failed: a 4xx means the token is not a valid session (publishable key, anon
 * JWT, expired or forged token) → 401. Anything else is a real failure (null → 500).
 */
export function userErrorStatus(error: { status?: number }): 401 | null {
  const s = error.status ?? 0;
  return s >= 400 && s < 500 ? 401 : null;
}

/**
 * my_permissions / is_editor failed. JWT errors (PGRST301/302/303, HTTP 401) → 401;
 * permission errors (42501, HTTP 403) → 403. null: a real failure (→ 500), or PGRST202
 * (the RPC is missing), which the caller handles.
 */
export function rpcErrorStatus(error: { code?: string; status?: number }): 401 | 403 | null {
  if (error.code === 'PGRST301' || error.code === 'PGRST302' || error.code === 'PGRST303') return 401;
  if (error.code === '42501') return 403;
  if (error.code === 'PGRST202') return null;
  if (error.status === 401) return 401;
  if (error.status === 403) return 403;
  return null;
}

/** Years the workbook can exist for; others are refused before any upstream call. */
export function inWorkbookRange(iso: string): boolean {
  const y = Number(iso.slice(0, 4));
  return y >= 2020 && y <= 2100;
}
