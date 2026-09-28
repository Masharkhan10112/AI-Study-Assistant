-- AI Study Assistant — the content side of the schema.
--
-- subjects ── documents ── document_chunks
--                      └── summaries
--
-- A document is the unit the student uploads; a chunk is the unit retrieval
-- works with. Chunks carry a denormalised user_id so that a vector search can
-- be filtered by owner without joining back to documents.

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index subjects_user_id_idx on public.subjects (user_id) where archived_at is null;

create trigger subjects_set_updated_at
  before update on public.subjects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- A document may sit outside any subject; clearing a subject must not delete
  -- the material, hence on delete set null.
  subject_id uuid references public.subjects (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 300),
  source_type public.document_source not null,
  -- Path inside the private `materials` bucket: {user_id}/{document_id}/source.{ext}.
  -- Null for pasted text, which has no stored object.
  storage_path text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  page_count integer check (page_count is null or page_count >= 0),
  -- SHA-256 of the uploaded bytes. Uploading the same file twice is rejected
  -- rather than re-embedded, which is the single largest avoidable AI cost.
  checksum text,
  status public.document_status not null default 'pending',
  error text,
  ingested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_storage_path_required
    check (source_type = 'paste' or storage_path is not null),
  constraint documents_error_only_when_failed
    check (status = 'failed' or error is null)
);

create unique index documents_user_checksum_key
  on public.documents (user_id, checksum)
  where checksum is not null;

create index documents_user_created_idx on public.documents (user_id, created_at desc);
create index documents_subject_idx on public.documents (subject_id) where subject_id is not null;
create index documents_status_idx on public.documents (status) where status <> 'ready';

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- document_chunks
-- ---------------------------------------------------------------------------
create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) > 0),
  token_count integer check (token_count is null or token_count >= 0),
  page_from integer check (page_from is null or page_from >= 1),
  page_to integer check (page_to is null or page_to >= 1),
  heading text,
  -- Dimension is fixed by the embedding model (text-embedding-3-small, 1536).
  -- Changing the model means an ALTER TYPE plus a full re-embed.
  embedding extensions.vector(1536),
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  constraint document_chunks_page_range check (page_to is null or page_from is null or page_to >= page_from)
);

-- Approximate nearest neighbour over cosine distance. Built after ingestion in
-- bulk loads; HNSW keeps recall high without a training step.
create index document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create index document_chunks_fts_idx on public.document_chunks using gin (fts);
create index document_chunks_user_idx on public.document_chunks (user_id);
create index document_chunks_document_idx on public.document_chunks (document_id, chunk_index);

-- ---------------------------------------------------------------------------
-- summaries
-- ---------------------------------------------------------------------------
create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  style public.summary_style not null default 'brief',
  content_md text not null,
  model text not null,
  created_at timestamptz not null default now(),
  -- One cached summary per document and style; regenerating replaces it.
  unique (document_id, style)
);

create index summaries_user_idx on public.summaries (user_id, created_at desc);
