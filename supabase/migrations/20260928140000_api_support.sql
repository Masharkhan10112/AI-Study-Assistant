-- Support objects for the Edge Function API: usage accumulation and
-- idempotent generation.

-- Accumulates one counter row per user/day/function/model. Done in SQL so a
-- concurrent second request cannot lose an update the way read-modify-write
-- from the function would.
create or replace function public.record_ai_usage(
  p_user_id uuid,
  p_function_name text,
  p_model text,
  p_requests integer default 1,
  p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0,
  p_cost_cents numeric default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.ai_usage (
    user_id, usage_date, function_name, model,
    requests, prompt_tokens, completion_tokens, cost_cents
  )
  values (
    p_user_id, (now() at time zone 'utc')::date, p_function_name, p_model,
    greatest(p_requests, 0), greatest(p_prompt_tokens, 0), greatest(p_completion_tokens, 0),
    greatest(p_cost_cents, 0)
  )
  on conflict (user_id, usage_date, function_name, model) do update
     set requests          = public.ai_usage.requests + excluded.requests,
         prompt_tokens     = public.ai_usage.prompt_tokens + excluded.prompt_tokens,
         completion_tokens = public.ai_usage.completion_tokens + excluded.completion_tokens,
         cost_cents        = public.ai_usage.cost_cents + excluded.cost_cents,
         updated_at        = now();
$$;

revoke execute on function public.record_ai_usage(uuid, text, text, integer, integer, integer, numeric) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, text, integer, integer, integer, numeric) to service_role;

comment on function public.record_ai_usage is
  'Service-role only: accumulates AI usage for the caller-supplied user. Clients must never write ai_usage.';

-- Backs the Idempotency-Key header on generation endpoints. The unique
-- constraint is the lock: the first request inserts the key, a retry collides
-- and either replays the stored response or is told the original is in flight.
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  function_name text not null,
  key text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  constraint idempotency_keys_key_length check (char_length(key) between 1 and 200),
  constraint idempotency_keys_unique unique (user_id, function_name, key)
);

create index idempotency_keys_created_at_idx on public.idempotency_keys (created_at);

-- RLS on with no policies at all: only the service role reaches this table.
alter table public.idempotency_keys enable row level security;

comment on table public.idempotency_keys is
  'Replay protection for generation endpoints. Written exclusively by Edge Functions via the service role.';
