-- AI Study Assistant — tutor chat, the ingestion queue and usage accounting.
--
-- chat_threads ── chat_messages ── message_citations ── document_chunks
-- ingestion_jobs drives the upload → chunk → embed pipeline.
-- ai_usage is the ledger the Edge Functions check before every model call.

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  title text not null default 'New chat',
  -- Retrieval scope: {"document_ids": [...]} or {} for "everything I own".
  scope jsonb not null default '{}'::jsonb,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_threads_scope_is_object check (jsonb_typeof(scope) = 'object')
);

create index chat_threads_user_idx on public.chat_threads (user_id, last_message_at desc);

create trigger chat_threads_set_updated_at
  before update on public.chat_threads
  for each row execute function public.set_updated_at();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.chat_role not null,
  content text not null,
  model text,
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at);
create index chat_messages_user_idx on public.chat_messages (user_id);

-- Bump the thread's ordering key when a message lands, so the sidebar does not
-- need an aggregate over chat_messages.
create or replace function public.touch_chat_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

create trigger on_chat_message_created
  after insert on public.chat_messages
  for each row execute function public.touch_chat_thread();

-- Which passages an answer was built from. The UI renders these as citations
-- that jump to the source page.
create table public.message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  chunk_id uuid not null references public.document_chunks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rank smallint not null check (rank >= 1),
  snippet text,
  unique (message_id, chunk_id)
);

create index message_citations_message_idx on public.message_citations (message_id, rank);

-- ---------------------------------------------------------------------------
-- ingestion queue
-- ---------------------------------------------------------------------------
-- A large PDF cannot be processed inside one request, so uploads enqueue a job
-- that a scheduled worker drains. run_after gives exponential backoff and
-- locked_at prevents two workers picking up the same job.
create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  status public.job_status not null default 'queued',
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 5 check (max_attempts > 0),
  last_error text,
  -- Resume point, so a re-queued job continues instead of restarting.
  next_page integer not null default 1 check (next_page >= 1),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live job per document: re-uploading does not double-embed.
create unique index ingestion_jobs_active_document_key
  on public.ingestion_jobs (document_id)
  where status in ('queued', 'running');

create index ingestion_jobs_claim_idx
  on public.ingestion_jobs (run_after)
  where status = 'queued';

create trigger ingestion_jobs_set_updated_at
  before update on public.ingestion_jobs
  for each row execute function public.set_updated_at();

-- Enqueue ingestion as soon as a document row appears with a stored object.
create or replace function public.enqueue_document_ingestion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and new.source_type <> 'paste' then
    insert into public.ingestion_jobs (user_id, document_id)
    values (new.user_id, new.id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger on_document_created
  after insert on public.documents
  for each row execute function public.enqueue_document_ingestion();

-- ---------------------------------------------------------------------------
-- AI usage ledger
-- ---------------------------------------------------------------------------
-- One row per user, day, function and model. The daily cap check is a single
-- indexed aggregate, and the same table backs the per-user cost view.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  usage_date date not null default current_date,
  function_name text not null,
  model text not null,
  requests integer not null default 0 check (requests >= 0),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  cost_cents numeric(10, 4) not null default 0 check (cost_cents >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, usage_date, function_name, model)
);

create index ai_usage_user_day_idx on public.ai_usage (user_id, usage_date desc);

create trigger ai_usage_set_updated_at
  before update on public.ai_usage
  for each row execute function public.set_updated_at();
