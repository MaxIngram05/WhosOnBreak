/**
 * The whole database interface, deliberately tiny.
 *
 * There is no ORM here. Every query in this service is SQL we wrote, which
 * means the query that runs is the query you can read, and the thing that
 * makes this app fast -- integer range work on the minute-of-week axis -- is
 * never hidden behind a query builder guessing at joins.
 *
 * Two lines of interface is also the entire cost of staying portable. Neon in
 * production, PGlite in tests, and anything speaking Postgres later, all
 * behind the same two methods.
 */

/** A connection, or a transaction: callers cannot tell and should not care. */
export interface Sql {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;

  /**
   * Runs one or more statements with no parameters and no result.
   *
   * Separate from `query` because a migration file is many statements at once,
   * and that only works over the simple protocol. Never build a string for
   * this from user input -- it is for SQL we shipped.
   */
  exec(text: string): Promise<void>;

  /**
   * Runs `fn` in a transaction, committing if it returns and rolling back if
   * it throws. Nested calls reuse the outer transaction rather than opening a
   * second one, so a repository method is safe to call on its own or as part
   * of something larger.
   */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

/** A pool that also needs closing, which tests and scripts care about. */
export interface Database extends Sql {
  close(): Promise<void>;
}

/** Exactly one row, or a failure. For lookups by primary key. */
export async function queryOne<Row>(
  sql: Sql,
  text: string,
  params?: readonly unknown[],
): Promise<Row | undefined> {
  const rows = await sql.query<Row>(text, params);
  return rows[0];
}

/**
 * Postgres error codes we actually branch on. Catching the specific violation
 * is what lets us turn a race into a clean 409 instead of a 500.
 */
export const PG_ERROR = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
} as const;

export function isPgError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Builds `$1, $2, $3` and friends for a multi-row insert.
 *
 * Replacing a whole week of blocks is one statement rather than one per block,
 * which on a serverless database is the difference between a round trip and
 * fifty of them.
 */
export function placeholders(rowCount: number, columnCount: number, offset = 0): string {
  const rows: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const columns: string[] = [];
    for (let column = 0; column < columnCount; column++) {
      columns.push(`$${offset + row * columnCount + column + 1}`);
    }
    rows.push(`(${columns.join(", ")})`);
  }
  return rows.join(", ");
}
