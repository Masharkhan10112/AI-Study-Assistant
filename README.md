# AI Study Assistant

A study platform built around a student's own material: upload lecture notes and
past papers, get grounded answers with citations, and turn them into summaries,
flashcards on a spaced-repetition schedule, quizzes, and a study plan.

The backend is Supabase — PostgreSQL (with `pgvector`) for data and retrieval,
Supabase Auth for identity, Storage for uploaded files, and Edge Functions for
the AI calls. The React/TypeScript frontend is a later phase; this repository
currently contains the database schema, Supabase configuration and the REST API.

## Getting started

Requires Docker and Node 20+.

```bash
npm install
npx supabase start            # applies all migrations and the seed
npx supabase status           # copy the API URL and anon key into .env
cp .env.example .env
```

Studio runs at http://127.0.0.1:54323 and the local mail catcher at
http://127.0.0.1:54324. Sign in as the seeded student with
`demo@studyai.test` / `studyai-2026`.

| Command | Purpose |
| --- | --- |
| `npm run db:reset` | Re-apply every migration and re-seed |
| `npm run db:lint` | Static analysis of the schema |
| `npm run db:diff` | Diff local changes into a new migration |
| `npm run db:push` | Apply migrations to the linked hosted project |
| `npm run gen:types` | Generate TypeScript types from the local schema |
| `npm run fn:serve` | Serve the Edge Functions locally |
| `npm run fn:test` | Run the Edge Function test suite (Deno) |
| `npm run fn:check` | Type-check, lint and format-check the functions |

The AI endpoints need provider credentials, which stay server-side:

```bash
supabase secrets set AI_BASE_URL=... AI_API_KEY=... AI_CHAT_MODEL=... AI_EMBEDDING_MODEL=...
```

## Repository layout

```
supabase/
  config.toml      local stack + auth configuration
  migrations/      schema, RLS, storage, functions (applied in filename order)
  seed.sql         local-only demo student and study data
  functions/       Edge Functions: the REST API
    _shared/       auth, validation, errors, provider, quota, retrieval
    _tests/        Deno tests
docs/
  database.md      tables, relationships, constraints, auth and RLS model
  api.md           endpoints, request/response shapes, errors
```

## Schema at a glance

`profiles` (1:1 with `auth.users`) owns everything. `subjects` group
`documents`, which are chunked into `document_chunks` — the embedded, full-text
indexed passages every AI answer is retrieved from and cites. Study artefacts
hang off those: `summaries`, `decks`/`cards` with `card_schedule` and
`review_logs`, `quizzes` with questions/attempts/answers, `study_plans` with
items, and `study_sessions`. `chat_threads`/`chat_messages`/`message_citations`
hold tutor conversations, while `ingestion_jobs` and `ai_usage` run the
processing queue and enforce per-user AI budgets.

Every table has row level security keyed on `auth.uid()`, uploaded files live in
a private Storage bucket namespaced by user id, and the tables the pipeline owns
(`document_chunks`, `ingestion_jobs`, `ai_usage`) are read-only to clients.

See [docs/database.md](docs/database.md) for the full explanation.

## API at a glance

Ordinary CRUD goes straight to PostgREST under RLS. Everything that needs a
provider key, a multi-step pipeline or a privileged write is an Edge Function:
`POST /functions/v1/{ingest,search,ai-chat,ai-generate,ai-grade}`. All of them
require a Supabase bearer token and answer errors as
`{"error":{"code":"...","message":"..."}}`.

See [docs/api.md](docs/api.md) for the full reference.
