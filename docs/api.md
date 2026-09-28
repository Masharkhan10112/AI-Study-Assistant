# API

Two layers, split on a single rule: anything that needs a provider key, a
multi-step pipeline or a write the client is not allowed to make is an Edge
Function; everything else is plain CRUD.

| Layer | Used for |
| --- | --- |
| PostgREST (`/rest/v1/...`) | Subjects, documents, decks, cards, reviews, quizzes, plans, sessions, threads — RLS decides what the caller can see |
| Edge Functions (`/functions/v1/...`) | Ingestion, retrieval, chat, generation, grading |

## Conventions

Every function is `POST`, takes and returns JSON, and requires the caller's
Supabase access token:

```
Authorization: Bearer <supabase access token>
Content-Type: application/json
```

Reads of the caller's own rows go through a client created with the anon key
plus that token, so RLS — not handler code — is what enforces ownership. The
service role is used only for writes the client is deliberately barred from
(`document_chunks`, `ingestion_jobs`, `ai_usage`, `idempotency_keys`).

Bodies are capped at 1 MB. `OPTIONS` is answered for CORS; any other method is
`405`.

### Errors

```json
{ "error": { "code": "invalid_request", "message": "Request failed validation.", "details": [
  { "path": "document_ids.0", "message": "Invalid uuid" }
] } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid_request` | 400 | Body failed validation; `details` lists the fields |
| `unauthorized` | 401 | Missing, malformed or expired bearer token |
| `not_found` | 404 | No such row *for this caller* — a foreign row is indistinguishable from a missing one |
| `method_not_allowed` | 405 | Not a `POST` |
| `conflict` | 409 | Already in flight (ingestion, or a duplicate idempotency key) |
| `document_not_ready` | 409 | The document has not finished ingesting |
| `quota_exceeded` | 429 | Daily token budget spent |
| `rate_limited` | 429 | Too many requests, or the provider rate-limited us |
| `internal_error` | 500 | Unexpected fault; details are logged, never returned |
| `provider_unavailable` | 503 | The model failed or returned unusable output |

Unexpected exceptions are logged server-side and flattened to `internal_error`,
so provider URLs, keys and database messages never reach the client.

### Quotas and rate limits

`assertWithinQuota` reads the caller's `daily_token_limit` (default 200 000) and
today's `ai_usage` row *before* any provider call, so an over-budget user is
rejected without spending tokens. Afterwards `record_ai_usage` accumulates
requests, prompt and completion tokens atomically per day, function and model.
Each function also applies a per-user, per-isolate sliding-window rate limit.

## `POST /functions/v1/ingest`

Turns an uploaded or pasted document into embedded, searchable chunks.

```json
{ "document_id": "uuid", "text": "only for pasted documents", "force": false }
```

```json
{ "status": "ready", "chunk_count": 42, "skipped": false }
```

PDF, TXT and Markdown are supported; anything else is rejected with
`invalid_request` rather than stored half-processed. Text is split into ~800
token chunks with 15% overlap, page ranges preserved, and embedded 32 at a time.
A document that is already `ready` is a no-op unless `force` is set, in which
case its chunks are replaced. One that is `processing` is a `conflict`. Failures
mark the document and its ingestion job `failed` with the reason, so the client
can show it and retry.

## `POST /functions/v1/search`

```json
{ "query": "how does the Krebs cycle start", "subject_id": "uuid", "document_ids": ["uuid"], "limit": 10 }
```

```json
{ "hits": [ { "chunk_id": "uuid", "document_id": "uuid", "content": "...", "page_from": 7, "page_to": 7, "heading": "...", "score": 0.82 } ] }
```

Scope resolves under RLS: explicit `document_ids` win over `subject_id`, and a
subject with no documents returns nothing rather than silently widening to the
whole library. Retrieval is the `hybrid_search_chunks` RPC — vector similarity
fused with full-text rank.

## `POST /functions/v1/ai-chat`

```json
{ "thread_id": "uuid", "message": "explain glycolysis", "scope": { "subject_id": "uuid" }, "stream": true }
```

The turn is grounded: the question is embedded, the top passages are retrieved
and numbered into the prompt, and the model is told to cite them as `[1]`. Only
markers that map to a retrieved passage are persisted into `message_citations`,
so a hallucinated citation is dropped instead of stored.

With `stream: false`:

```json
{ "message_id": "uuid", "content": "Glycolysis ... [1]", "citations": [ { "chunkId": "uuid", "rank": 1, "snippet": "..." } ], "sources": [ { "n": 1, "chunk_id": "uuid", "document_id": "uuid", "page_from": 3, "page_to": 3, "heading": "Glycolysis" } ] }
```

Otherwise the response is `text/event-stream`:

| Event | Payload |
| --- | --- |
| `sources` | The retrieved passages, sent before the first token so the UI can render them immediately |
| `token` | `{ "delta": "..." }` |
| `done` | `{ "message_id": "...", "citations": [...] }` |
| `error` | `{ "code": "...", "message": "..." }` |

Both paths persist the user message first and the assistant message once the
completion finishes, then record usage.

## `POST /functions/v1/ai-generate`

One endpoint, four resources, discriminated on `kind`:

| `kind` | Required options | Creates |
| --- | --- | --- |
| `summary` | `style` (`brief` \| `detailed` \| `outline`) — exactly one document | a `summaries` row, replacing any previous one for that document and style |
| `flashcards` | `count`, optional `deck_id`/`deck_name` | `cards` in a new or existing deck |
| `quiz` | `count`, `difficulty`, `question_types` | a `quizzes` row with its questions |
| `plan` | `goal`, `exam_date`, `daily_minutes` | a `study_plans` row with dated items |

```json
{ "kind": "quiz", "document_ids": ["uuid"], "options": { "count": 10, "question_types": ["mcq", "short_answer"] } }
```

```json
{ "kind": "quiz", "resource": "quiz", "resource_id": "uuid", "created": 10, "model": "gpt-4o-mini" }
```

Every document must be owned and `ready`; otherwise `not_found` or
`document_not_ready` before a token is spent. The model answers in JSON, which
is validated with the same schemas that mirror the database's check constraints
— a malformed quiz is `provider_unavailable`, never a half-written row. Chunk
references the model returns are mapped back to real `chunk_id`s and dropped if
out of range.

Generation is expensive, so it honours `Idempotency-Key`: the first request
claims the key, a retry replays the stored response, a duplicate arriving while
the first is still running is a `conflict`, and a failed request releases the
key so the retry can genuinely re-run.

## `POST /functions/v1/ai-grade`

```json
{ "attempt_id": "uuid" }
```

```json
{ "attempt_id": "uuid", "score": 0.8, "per_question": [ { "question_id": "uuid", "score": 1, "is_correct": true, "feedback": "..." } ] }
```

MCQ and true/false are graded by comparison (case, spacing and trailing
punctuation insensitive) with no model call at all; only short answers are sent
to the provider, and usage is recorded only when that happens. The attempt's
score, submission time and duration are written back with the per-answer
feedback.

## Testing

```bash
npm run fn:test     # deno test --allow-env supabase/functions
npm run fn:check    # type-check, lint, format
```

The suite covers the HTTP envelope, request and model-output schemas, provider
failure mapping and SSE parsing, chunking, retrieval and citation extraction,
quota and rate limiting, idempotency, and each endpoint end to end against fake
Supabase and provider clients — including ownership, quota exhaustion, provider
outages and malformed model output.
