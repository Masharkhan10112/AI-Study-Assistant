-- AI Study Assistant — retrieval RPCs and reading views.
--
-- Every function here is security invoker: it runs as the caller, so Row Level
-- Security still applies and a user can only ever retrieve their own chunks.
-- The Edge Functions call them with the caller's JWT for exactly that reason.

-- Pure vector search. `filter_document_ids` scopes a chat thread to a subset of
-- the library; null means "everything I own".
create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  similarity_threshold double precision default 0.2,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  heading text,
  page_from integer,
  page_to integer,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.heading,
    c.page_from,
    c.page_to,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.embedding is not null
    and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    and 1 - (c.embedding <=> query_embedding) >= similarity_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- Hybrid retrieval: vector and full text results merged with reciprocal rank
-- fusion. Fusion needs no score normalisation between the two scales, which is
-- what makes it robust when one side returns nothing useful.
create or replace function public.hybrid_search_chunks(
  query_text text,
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  rrf_k integer default 60,
  filter_document_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  content text,
  heading text,
  page_from integer,
  page_to integer,
  score double precision
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with semantic as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from public.document_chunks c
    where c.embedding is not null
      and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1) * 4
  ),
  lexical as (
    select c.id, row_number() over (
             order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
           ) as rank
    from public.document_chunks c
    where c.fts @@ websearch_to_tsquery('english', query_text)
      and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    limit greatest(match_count, 1) * 4
  ),
  fused as (
    select
      coalesce(s.id, l.id) as id,
      coalesce(1.0 / (rrf_k + s.rank), 0) + coalesce(1.0 / (rrf_k + l.rank), 0) as score
    from semantic s
    full outer join lexical l on l.id = s.id
  )
  select c.id, c.document_id, c.content, c.heading, c.page_from, c.page_to, f.score
  from fused f
  join public.document_chunks c on c.id = f.id
  order by f.score desc
  limit greatest(match_count, 1);
$$;

-- The review queue. A view rather than a function so the client can page and
-- filter it; security_invoker keeps RLS in force.
create view public.due_cards
with (security_invoker = true)
as
select
  c.id as card_id,
  c.user_id,
  c.deck_id,
  d.name as deck_name,
  c.front,
  c.back,
  c.card_type,
  s.state,
  s.due_at,
  s.reps,
  s.lapses
from public.cards c
join public.card_schedule s on s.card_id = c.id
join public.decks d on d.id = c.deck_id
where not c.suspended
  and s.due_at <= now();

-- Today's AI spend per user, the number the quota check and the settings page
-- both read.
create view public.ai_usage_today
with (security_invoker = true)
as
select
  user_id,
  usage_date,
  sum(requests)::bigint as requests,
  sum(prompt_tokens)::bigint as prompt_tokens,
  sum(completion_tokens)::bigint as completion_tokens,
  sum(prompt_tokens + completion_tokens)::bigint as total_tokens,
  sum(cost_cents)::numeric(12, 4) as cost_cents
from public.ai_usage
where usage_date = current_date
group by user_id, usage_date;

-- Atomically claim the next ingestion job. Called by the scheduled worker under
-- the service role; `for update skip locked` keeps two workers off one job.
create or replace function public.claim_ingestion_job()
returns public.ingestion_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.ingestion_jobs;
begin
  select * into job
  from public.ingestion_jobs
  where status = 'queued' and run_after <= now()
  order by run_after
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.ingestion_jobs
     set status = 'running',
         attempts = attempts + 1,
         locked_at = now()
   where id = job.id
  returning * into job;

  update public.documents
     set status = 'processing'
   where id = job.document_id;

  return job;
end;
$$;

-- Only the service role may claim jobs; the default grant to authenticated is
-- revoked so a signed-in client cannot drain the queue.
revoke all on function public.claim_ingestion_job() from public, anon, authenticated;
grant execute on function public.claim_ingestion_job() to service_role;
