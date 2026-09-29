import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

// Client for the Edge Functions. Every call carries the caller's access token,
// and every failure arrives as the API's `{ error: { code, message } }`
// envelope, so the UI can react to a code instead of matching on prose.

export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "document_not_ready"
  | "quota_exceeded"
  | "rate_limited"
  | "internal_error"
  | "provider_unavailable";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Wording the user can act on, for codes whose server message is generic. */
  get friendlyMessage(): string {
    switch (this.code) {
      case "quota_exceeded":
        return "You have used today's AI budget. It resets at midnight UTC, or raise the cap in Settings.";
      case "rate_limited":
        return "Too many requests in a row — give it a few seconds and try again.";
      case "provider_unavailable":
        return "The AI provider did not answer. Try again in a moment.";
      case "document_not_ready":
        return "That document is still being processed. Wait for it to turn ready and retry.";
      case "unauthorized":
        return "Your session expired. Sign in again.";
      default:
        return this.message;
    }
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: { path: string; message: string }[] };
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorEnvelope = {};
  try {
    body = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON failure (a gateway error, say) still has to reach the UI as one.
  }
  return new ApiError(
    (body.error?.code as ApiErrorCode) ?? "internal_error",
    body.error?.message ?? `Request failed with status ${response.status}.`,
    body.error?.details,
  );
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError("unauthorized", "You are not signed in.");
  return {
    "content-type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function callFunction<T>(
  name: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: await authHeaders(extraHeaders),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

// --- ingest ---------------------------------------------------------------

export interface IngestResult {
  status: string;
  chunk_count: number;
  skipped: boolean;
}

export function ingest(input: { document_id: string; text?: string; force?: boolean }) {
  return callFunction<IngestResult>("ingest", input);
}

// --- search ---------------------------------------------------------------

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  content: string;
  heading: string | null;
  page_from: number | null;
  page_to: number | null;
  score: number;
}

export function search(input: {
  query: string;
  subject_id?: string | null;
  document_ids?: string[] | null;
  limit?: number;
}) {
  return callFunction<{ hits: SearchHit[] }>("search", input);
}

// --- generate -------------------------------------------------------------

export interface GenerateResult {
  kind: string;
  resource: string;
  resource_id: string;
  created: number;
  model: string;
}

export type GenerateRequest =
  | { kind: "summary"; document_ids: [string]; options?: { style?: "brief" | "detailed" | "outline" } }
  | {
    kind: "flashcards";
    document_ids: string[];
    options?: { count?: number; deck_id?: string | null; deck_name?: string; subject_id?: string | null };
  }
  | {
    kind: "quiz";
    document_ids: string[];
    options?: {
      count?: number;
      difficulty?: "easy" | "medium" | "hard";
      question_types?: ("mcq" | "true_false" | "short_answer")[];
      title?: string;
      subject_id?: string | null;
    };
  }
  | {
    kind: "plan";
    document_ids: string[];
    options: { goal: string; exam_date: string; daily_minutes?: number; subject_id?: string | null };
  };

/**
 * Generation is expensive, so each request carries an idempotency key: a retry
 * after a dropped connection replays the first result instead of paying twice.
 */
export function generate(input: GenerateRequest, idempotencyKey = crypto.randomUUID()) {
  return callFunction<GenerateResult>("ai-generate", input, { "idempotency-key": idempotencyKey });
}

// --- grade ----------------------------------------------------------------

export interface GradeResult {
  attempt_id: string;
  score: number;
  per_question: { question_id: string; is_correct: boolean; score: number; feedback: string | null }[];
}

export function grade(attemptId: string) {
  return callFunction<GradeResult>("ai-grade", { attempt_id: attemptId });
}

// --- chat -----------------------------------------------------------------

export interface ChatSource {
  n: number;
  chunk_id: string;
  document_id: string;
  page_from: number | null;
  page_to: number | null;
  heading: string | null;
}

export interface ChatCitation {
  chunkId: string;
  rank: number;
  snippet: string;
}

export interface ChatScope {
  document_ids?: string[];
  subject_id?: string | null;
}

export interface ChatCallbacks {
  onSources?(sources: ChatSource[]): void;
  onToken?(delta: string): void;
  onDone?(payload: { message_id: string; citations: ChatCitation[] }): void;
  signal?: AbortSignal;
}

/**
 * Streams an answer over SSE. Tokens arrive as they are generated; `sources`
 * lands before the first token so the citation panel can render immediately.
 */
export async function streamChat(
  input: { thread_id: string; message: string; scope?: ChatScope },
  callbacks: ChatCallbacks,
): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ ...input, stream: true }),
    signal: callbacks.signal,
  });

  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new ApiError("internal_error", "The server sent no response body.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; a partial frame stays buffered.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      handleFrame(buffer.slice(0, boundary), callbacks);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function handleFrame(frame: string, callbacks: ChatCallbacks): void {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7).trim();
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  if (data.length === 0) return;

  const payload = JSON.parse(data.join("\n"));
  switch (event) {
    case "sources":
      callbacks.onSources?.(payload.sources as ChatSource[]);
      break;
    case "token":
      callbacks.onToken?.(payload.delta as string);
      break;
    case "done":
      callbacks.onDone?.(payload as { message_id: string; citations: ChatCitation[] });
      break;
    case "error": {
      const error = payload.error as { code: string; message: string };
      throw new ApiError(error.code as ApiErrorCode, error.message);
    }
  }
}
