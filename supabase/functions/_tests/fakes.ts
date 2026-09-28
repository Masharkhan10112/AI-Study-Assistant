import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "../_shared/auth.ts";
import type { Deps } from "../_shared/deps.ts";
import type { AiProvider, ChatMessage, CompletionResult } from "../_shared/provider.ts";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface Call {
  table: string;
  op: string;
  payload?: unknown;
}

/**
 * A minimal in-memory stand-in for the PostgREST client: enough of the builder
 * to exercise the handlers' real query chains without a database. Unsupported
 * operators throw rather than silently returning everything, so a test can
 * never pass because a filter was ignored.
 */
export class FakeDb {
  readonly tables: Tables;
  readonly calls: Call[] = [];
  readonly rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  rpcResults: Record<string, unknown> = {};
  failures: Record<string, string> = {};
  storageFiles: Record<string, string> = {};
  private sequence = 0;

  constructor(tables: Tables = {}) {
    this.tables = tables;
  }

  rows(table: string): Row[] {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args });
    const failure = this.failures[`rpc:${name}`];
    return Promise.resolve(
      failure
        ? { data: null, error: { message: failure } }
        : { data: this.rpcResults[name] ?? null, error: null },
    );
  }

  get storage() {
    return {
      from: (_bucket: string) => ({
        download: (path: string) => {
          const content = this.storageFiles[path];
          return Promise.resolve(
            content === undefined
              ? { data: null, error: { message: "Object not found" } }
              : { data: new Blob([content]), error: null },
          );
        },
      }),
    };
  }

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

type Filter = (row: Row) => boolean;

class FakeQuery implements PromiseLike<{ data: any; error: any; count?: number }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row[] = [];
  private conflictColumns: string[] = [];
  private returnRows = false;
  private singleMode: "one" | "maybe" | null = null;
  private headCount = false;
  private limitValue: number | null = null;
  private sortKeys: { column: string; ascending: boolean }[] = [];

  constructor(private db: FakeDb, private table: string) {}

  select(_columns = "*", options: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") this.db.calls.push({ table: this.table, op: "select" });
    this.returnRows = true;
    this.headCount = options.head === true;
    return this;
  }

  insert(values: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    this.db.calls.push({ table: this.table, op: "insert", payload: this.payload });
    return this;
  }

  upsert(values: Row | Row[], options: { onConflict?: string } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.conflictColumns = options.onConflict?.split(",").map((c) => c.trim()) ?? [];
    this.db.calls.push({ table: this.table, op: "upsert", payload: this.payload });
    return this;
  }

  update(values: Row) {
    this.op = "update";
    this.payload = [values];
    this.db.calls.push({ table: this.table, op: "update", payload: values });
    return this;
  }

  delete() {
    this.op = "delete";
    this.db.calls.push({ table: this.table, op: "delete" });
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  match(criteria: Row) {
    this.filters.push((row) =>
      Object.entries(criteria).every(([key, value]) => row[key] === value)
    );
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.sortKeys.push({ column, ascending: options.ascending !== false });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  single() {
    this.singleMode = "one";
    return this;
  }

  private matches(): Row[] {
    return this.db.rows(this.table).filter((row) => this.filters.every((filter) => filter(row)));
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: any; count?: number }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { data: any; error: any; count?: number } {
    const failure = this.db.failures[`${this.table}:${this.op}`];
    if (failure) return { data: null, error: { message: failure, code: failure } };

    let result: Row[];
    switch (this.op) {
      case "select": {
        result = this.matches();
        for (const key of [...this.sortKeys].reverse()) {
          result = [...result].sort((a, b) => {
            const left = String(a[key.column] ?? "");
            const right = String(b[key.column] ?? "");
            return key.ascending ? left.localeCompare(right) : right.localeCompare(left);
          });
        }
        if (this.limitValue !== null) result = result.slice(0, this.limitValue);
        if (this.headCount) return { data: null, error: null, count: result.length };
        break;
      }
      case "insert": {
        const inserted = this.payload.map((row) => ({ id: this.db.nextId(this.table), ...row }));
        const unique = this.db.failures[`${this.table}:unique`];
        if (unique) return { data: null, error: { message: "duplicate key", code: "23505" } };
        this.db.rows(this.table).push(...inserted);
        result = inserted;
        break;
      }
      case "upsert": {
        result = this.payload.map((row) => {
          const existing = this.db.rows(this.table).find((candidate) =>
            this.conflictColumns.length > 0 &&
            this.conflictColumns.every((column) => candidate[column] === row[column])
          );
          if (existing) {
            Object.assign(existing, row);
            return existing;
          }
          const inserted = { id: this.db.nextId(this.table), ...row };
          this.db.rows(this.table).push(inserted);
          return inserted;
        });
        break;
      }
      case "update": {
        result = this.matches();
        for (const row of result) Object.assign(row, this.payload[0]);
        break;
      }
      case "delete": {
        result = this.matches();
        this.db.tables[this.table] = this.db.rows(this.table).filter((row) =>
          !result.includes(row)
        );
        break;
      }
    }

    if (this.singleMode === "one") {
      if (result.length !== 1) {
        return { data: null, error: { message: `expected exactly one row, got ${result.length}` } };
      }
      return { data: result[0], error: null };
    }
    if (this.singleMode === "maybe") {
      return { data: result[0] ?? null, error: null };
    }
    return { data: result, error: null };
  }
}

export interface FakeProviderOptions {
  completion?: string | ((messages: ChatMessage[]) => string);
  embedding?: number[];
  failWith?: Error;
}

export class FakeProvider implements AiProvider {
  chatModel = "fake-chat";
  embeddingModel = "fake-embed";
  readonly completions: ChatMessage[][] = [];
  readonly embedCalls: string[][] = [];

  constructor(private options: FakeProviderOptions = {}) {}

  complete(messages: ChatMessage[]): Promise<CompletionResult> {
    this.completions.push(messages);
    if (this.options.failWith) return Promise.reject(this.options.failWith);
    const content = typeof this.options.completion === "function"
      ? this.options.completion(messages)
      : this.options.completion ?? "an answer [1]";
    return Promise.resolve({
      content,
      promptTokens: 100,
      completionTokens: 20,
      model: this.chatModel,
    });
  }

  stream(messages: ChatMessage[]) {
    this.completions.push(messages);
    if (this.options.failWith) return Promise.reject(this.options.failWith);
    const content = typeof this.options.completion === "function"
      ? this.options.completion(messages)
      : this.options.completion ?? "an answer [1]";
    const pieces = content.match(/.{1,5}/gs) ?? [];
    const tokens = new ReadableStream<string>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(piece);
        controller.close();
      },
    });
    return Promise.resolve({
      tokens,
      usage: Promise.resolve({
        content,
        promptTokens: 100,
        completionTokens: 20,
        model: this.chatModel,
      }),
    });
  }

  embed(inputs: string[]) {
    this.embedCalls.push(inputs);
    if (this.options.failWith) return Promise.reject(this.options.failWith);
    return Promise.resolve({
      embeddings: inputs.map(() => this.options.embedding ?? [0.1, 0.2, 0.3]),
      promptTokens: inputs.length * 5,
      model: this.embeddingModel,
    });
  }
}

export const TEST_USER = "11111111-1111-4111-8111-111111111111";

export function fakeContext(db: FakeDb, admin: FakeDb = db): AuthContext {
  return { userId: TEST_USER, db: db.asClient(), admin: admin.asClient() };
}

export function fakeDeps(
  ctx: AuthContext,
  provider: AiProvider = new FakeProvider(),
  now = new Date("2026-01-02T03:04:05.000Z"),
): Deps {
  return {
    authenticate: () => Promise.resolve(ctx),
    provider: () => provider,
    now: () => now,
  };
}

export function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://functions.test/endpoint", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test", ...headers },
    body: JSON.stringify(body),
  });
}

// Profile + usage rows every quota check reads.
export function withQuota(db: FakeDb, used = 0, cap = 200_000): FakeDb {
  db.rows("profiles").push({ id: TEST_USER, ai_daily_token_cap: cap });
  db.rows("ai_usage_today").push({ user_id: TEST_USER, total_tokens: used });
  return db;
}
