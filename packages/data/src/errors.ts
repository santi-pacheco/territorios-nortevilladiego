/**
 * Error taxonomy for the data layer. The retry policy keys off these classes:
 * only NetworkError is retried; ConflictError and DataError never are.
 */

/** CAS update/delete matched 0 rows. `current` is the refetched row (null = deleted or not visible). */
export class ConflictError<Row = unknown> extends Error {
  override readonly name = 'ConflictError';
  readonly table: string;
  readonly id: unknown;
  readonly expectedVersion: number;
  readonly current: Row | null;

  constructor(args: { table: string; id: unknown; expectedVersion: number; current: Row | null }) {
    super(`Conflict on ${args.table}: expected version ${args.expectedVersion}`);
    this.table = args.table;
    this.id = args.id;
    this.expectedVersion = args.expectedVersion;
    this.current = args.current;
  }

  /** The row is gone (deleted by someone else, or no longer readable). */
  get deleted(): boolean {
    return this.current === null;
  }

  /**
   * The row is still at the version we sent, so the 0-row result was not a concurrent
   * write: most likely RLS denied the update (e.g. editor role revoked). See supabase/README.md.
   */
  get likelyPermissionDenied(): boolean {
    const v = (this.current as { version?: unknown } | null)?.version;
    return v === this.expectedVersion;
  }
}

/** The request never reached PostgREST (offline, DNS, CORS, reset). Safe to retry. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** PostgREST / Postgres error (RLS, constraint, 23505 unique race, …). Not retried. */
export class DataError extends Error {
  override readonly name = 'DataError';
  readonly code: string;
  readonly status: number;
  readonly details: string | null;
  readonly hint: string | null;
  constructor(args: {
    message: string;
    code: string;
    status: number;
    details?: string | null;
    hint?: string | null;
  }) {
    super(args.message);
    this.code = args.code;
    this.status = args.status;
    this.details = args.details ?? null;
    this.hint = args.hint ?? null;
  }
  /** Unique violation: an insert raced on a natural key. */
  get isUniqueViolation(): boolean {
    return this.code === '23505';
  }
}

/** Zod rejected a row coming from the server. */
export class SchemaError extends Error {
  override readonly name = 'SchemaError';
  readonly table: string;
  constructor(table: string, message: string, options?: { cause?: unknown }) {
    super(`Invalid ${table} row: ${message}`, options);
    this.table = table;
  }
}

export function isConflictError(e: unknown): e is ConflictError {
  return e instanceof ConflictError;
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}
