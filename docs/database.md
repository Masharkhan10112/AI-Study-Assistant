# Database schema and Supabase configuration

The whole backend is Supabase: PostgreSQL for data, Supabase Auth for identity,
Supabase Storage for uploaded files, and Edge Functions (later phase) for the
privileged AI work. There is no separate application server, so **every access
rule lives in the database** as row level security (RLS).

Migrations live in `supabase/migrations/` and are applied in filename order:

| Migration | Contents |
| --- | --- |
| `20260928120000_extensions_and_helpers.sql` | Extensions (`pgcrypto`, `vector`, `pg_trgm`), enums, `set_updated_at()` |
| `20260928120100_profiles.sql` | `profiles` plus the auth triggers |
| `20260928120200_content.sql` | `subjects`, `documents`, `document_chunks`, `summaries` |
| `20260928120300_study.sql` | Decks, cards, scheduling, reviews, quizzes, plans, sessions |
| `20260928120400_ai.sql` | Chat threads/messages/citations, ingestion queue, AI usage |
| `20260928120500_row_level_security.sql` | RLS enablement and all table policies |
| `20260928120600_storage.sql` | `materials` and `avatars` buckets and their object policies |
| `20260928120700_functions_and_views.sql` | Retrieval RPCs, reporting views, job claiming |

## Authentication approach

**Identity is owned by Supabase Auth, not by the application.** `auth.users` is
the only user table; `public.profiles.id` is a primary key that is also a
foreign key to `auth.users(id) on delete cascade`. There is no second user id to
keep in sync, and deleting the auth user removes everything they own through the
cascade chain.

Two triggers on `auth.users` keep the profile in step:

- `on_auth_user_created` → `handle_new_user()` inserts the profile right after
  signup, reading `full_name` and `timezone` out of the signup metadata
  (`raw_user_meta_data`). Clients never insert profiles themselves, which is why
  `profiles` has no `insert` policy.
- `on_auth_user_email_changed` → `handle_user_email_change()` mirrors an email
  change into `profiles.email`.

Both are `security definer` with a pinned `search_path`, because the trigger
runs in the auth service's transaction and must write to a table the caller has
no direct rights to.

Authorisation then works off the JWT the client already holds:

- Every user-owned table carries `user_id uuid not null references auth.users(id) on delete cascade`,
  and its policies compare that column to `auth.uid()` (the `sub` claim of the
  verified JWT). An anonymous request has `auth.uid() = null`, so it matches
  nothing.
- The **anon/authenticated** keys are safe in the browser: they only ever reach
  the database through PostgREST as the `authenticated` role, under RLS.
- The **service role** key bypasses RLS and must stay server-side, in Edge
  Function secrets. It is what the ingestion worker and the AI functions use to
  write `document_chunks`, `ingestion_jobs`, and `ai_usage`.

Local auth settings are in `supabase/config.toml`: email/password signup, email
confirmations off for convenience, minimum password length 8 with
`lower_upper_letters_digits` required, site URL `http://localhost:5173` and
`/auth/callback` allowed as a redirect. Mirror the password rules and URLs in
the hosted project's Auth settings — `config.toml` only drives the local stack
unless the project is linked and config is pushed.

## Tables and relationships

### Identity

- **`profiles`** — one row per auth user. Display data (`full_name`,
  `avatar_url`, `timezone`, `theme`) plus study preferences
  (`daily_review_target`, `daily_study_minutes_target`) and the AI budget
  (`ai_daily_token_cap`, `ai_preferences`). Root of every ownership chain.

### Content and retrieval

- **`subjects`** — user-defined grouping ("Operating Systems"). Unique per user
  by name; `archived_at` soft-hides instead of deleting. Referenced by
  documents, decks, quizzes, plans, and sessions with `on delete set null`, so
  removing a subject never destroys study material.
- **`documents`** — one uploaded or pasted study source. Holds the Storage
  pointer (`storage_path`), file facts (`mime_type`, `byte_size`, `page_count`,
  `checksum`) and the ingestion lifecycle (`status`, `error`, `ingested_at`).
- **`document_chunks`** — the retrieval unit: a passage of a document with
  `embedding extensions.vector(1536)`, a generated `fts tsvector`, and
  `page_from`/`page_to`/`heading` so answers can cite a location. Written only by
  the ingestion pipeline.
- **`summaries`** — cached generated summaries, one per `(document_id, style)`
  where style is `brief | detailed | outline`.

### Flashcards and review

- **`decks`** → **`cards`** (`on delete cascade`). A card optionally keeps
  provenance: `document_id`, `chunk_id`, and a `source_quote`.
- **`card_schedule`** — 1:1 with `cards` (card id is the primary key), holding
  FSRS state: `state`, `due_at`, `stability`, `difficulty`, `reps`, `lapses`.
  Scheduling is split from content so rewording a card does not disturb its
  history, and the review queue only touches a narrow hot table. A trigger
  (`handle_new_card`) inserts the initial `new`/due-now row automatically.
- **`review_logs`** — append-only event log of every answer (`rating` 1–4,
  `elapsed_ms`, previous and next due dates). Retains enough to re-derive
  scheduling or re-fit FSRS parameters later.

### Quizzes

- **`quizzes`** → **`quiz_questions`** (unique `position` per quiz, `options`
  JSON for MCQs, `correct_answer`, `explanation`, and an optional `chunk_id` for
  provenance).
- **`quiz_attempts`** → **`quiz_answers`** (one answer per
  `(attempt_id, question_id)`). An attempt is a session: `started_at`, then
  `submitted_at`/`score` once graded.

### Planning and progress

- **`study_plans`** → **`plan_items`** — generated but fully editable plans.
  Items are ordered per day (`scheduled_for`, `position`), have an `activity`
  (`read | review | quiz | practice`), and may point at a document or deck.
- **`study_sessions`** — actual time spent, used for the progress charts.
  Separate from `plan_items` so planned and real effort can be compared.

### Tutor chat

- **`chat_threads`** → **`chat_messages`** → **`message_citations`**. A thread
  has a `scope` JSON object (which subject/documents the tutor may retrieve
  from); messages carry `role`, `content`, and per-message token/latency
  telemetry; citations link an assistant message to the exact chunks it used,
  so the UI can render "source: lecture 4, p.3".

### Operations

- **`ingestion_jobs`** — a queue row per document to extract/chunk/embed.
  `status`, `attempts`/`max_attempts`, `last_error`, `run_after` (backoff),
  `locked_at`, and `next_page` for resuming a large PDF. A trigger on
  `documents` enqueues a job whenever a document lands in `pending`, and a
  partial unique index guarantees at most one `queued`/`running` job per
  document.
- **`ai_usage`** — one counter row per `(user_id, usage_date, function_name, model)`
  with requests, prompt/completion tokens, and cost. This is what makes
  `ai_daily_token_cap` enforceable server-side rather than a UI suggestion.

## Constraints worth knowing

Constraints encode the rules that would otherwise be re-implemented (and
forgotten) in application code:

- `documents`: `storage_path` is required unless `source_type = 'paste'`;
  `error` may only be set when `status = 'failed'`; `checksum` is unique per
  user via a partial index, so re-uploading the same file is rejected instead of
  silently re-embedding it.
- `document_chunks`: unique `(document_id, chunk_index)`; `page_from <= page_to`
  when both are present.
- `subjects`: unique `(user_id, name)`; `color` must match `^#[0-9a-fA-F]{6}$`.
- Text fields that the UI renders (`documents.title`, `subjects.name`,
  `decks.name`, `cards.front`/`back`, `quiz_questions.stem`, `study_plans.goal`,
  `plan_items.title`) are length-checked and rejected when blank.
- `quiz_questions`: unique `position` per quiz; `options` must be a JSON array of
  2–8 entries for `mcq` and null otherwise.
- `quiz_attempts`: `score`/`max_score` may only be present once `submitted_at`
  is set.
- `review_logs.rating` is 1–4; `card_schedule` bounds `stability`, `difficulty`,
  `reps`, `lapses`.
- `study_sessions`: `ended_at >= started_at`.
- `ai_usage`: all counters non-negative, unique per user/day/function/model.
- `chat_threads.scope` must be a JSON object, not an array or scalar.

Indexes follow the access paths: `(user_id, created_at desc)` for list screens,
`(user_id, due_at)` on `card_schedule` for the review queue, an HNSW cosine
index on `document_chunks.embedding`, and a GIN index on the generated `fts`
column.

## Row level security

RLS is enabled on all 21 application tables. Three patterns are used:

1. **Owner CRUD** — `select/insert/update/delete` where `auth.uid() = user_id`
   (subjects, documents, decks, cards, quizzes, plans, sessions, threads, …).
2. **Read-only to the client** — `document_chunks`, `ingestion_jobs`, and
   `ai_usage` expose only a `select` policy. They are written exclusively by the
   service role, so a client cannot forge embeddings, jump the queue, or reset
   its own usage counters. `review_logs` additionally allows `insert`, but never
   `update`/`delete`: review history is append-only.
3. **Restrictive parent checks** — a matching `user_id` is not enough for child
   rows, because a user could otherwise attach a card to *someone else's* deck.
   Restrictive policies (`as restrictive`, AND-ed with the permissive ones)
   assert the parent is owned too: messages→threads, citations→messages,
   cards→decks, questions→quizzes, answers→attempts, plan items→plans,
   summaries→documents, and any `subject_id` reference→owned subject.

RLS decides *rows*, column privileges decide *columns*: `quiz_questions.correct_answer`
is revoked from `anon`/`authenticated`, so a student can read and take their own
quiz but cannot read the answer key out of it — grading runs as the service
role, which still sees it.

`profiles` has `select`/`update` on `auth.uid() = id` and deliberately no
`insert` or `delete` policy — creation is the trigger's job and deletion belongs
to the auth user.

## Storage

Two buckets, created in SQL so they are reproducible:

| Bucket | Public | Limit | Contents |
| --- | --- | --- | --- |
| `materials` | no | 50 MiB | Uploaded study files, PDF/DOCX/PPTX/TXT/MD/images |
| `avatars` | yes | 2 MiB | Profile images |

Object keys start with the owner's id — `materials/{user_id}/{document_id}/source.pdf`
— and the policies compare `(storage.foldername(name))[1]` to `auth.uid()::text`.
`materials` is owner-only for read and write, so files are served through signed
URLs; `avatars` is world-readable but owner-only for writes.

## Retrieval and operational helpers

- `match_document_chunks(query_embedding, match_count, similarity_threshold, filter_document_ids)`
  — cosine nearest neighbours over the caller's chunks.
- `hybrid_search_chunks(query_text, query_embedding, match_count, rrf_k, filter_document_ids)`
  — semantic and full-text results combined with reciprocal rank fusion, which
  handles exact terms (formulae, acronyms) that pure embeddings miss. Both run
  as the caller, so RLS still applies.
- `due_cards` — the review queue (security invoker view).
- `ai_usage_today` — today's totals per user, for quota checks and the UI meter.
- `review_card(card_id, rating, state, stability, difficulty, reps, lapses, due_at, elapsed_ms)`
  — writes the `review_logs` entry and the new `card_schedule` row in one
  transaction, reading the previous due date and state itself. Runs as the
  caller, so RLS decides whose card it is.
- `claim_ingestion_job()` — atomically claims one due job with
  `for update skip locked`, bumps `attempts`, and sets `locked_at`, so multiple
  workers can run safely. Execute is revoked from `anon`/`authenticated` and
  granted only to `service_role`.

## Local development

```bash
npx supabase start     # boots the stack and applies migrations + seed
npx supabase db reset  # re-applies everything from scratch
npx supabase status    # prints URLs and keys for .env
npx supabase db lint   # static check of the schema
```

`supabase/seed.sql` creates `demo@studyai.test` / `studyai-2026` with two
subjects, two ingested documents with chunks, a deck with review history, a
quiz, a plan, and usage rows. Chunk embeddings are left null (a real vector
needs the embedding model); the lexical half of hybrid search still works.
The seed is local-only — never run it against a hosted project.
