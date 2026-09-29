-- Support objects for the browser client: live document status and an atomic
-- card review.

-- The library watches its own rows so an ingestion that finishes out of band
-- flips the badge without polling. Realtime only forwards changes for tables
-- in the publication.
alter publication supabase_realtime add table public.documents;
-- Realtime authorises each change against the row it carries, so the whole row
-- has to be in the WAL record, not just the key.
alter table public.documents replica identity full;

-- RLS makes a quiz readable by its owner, and the answer key lives on the same
-- row as the question being asked. Column privileges keep the key out of the
-- client's reach — including from a hand-written PostgREST query — while the
-- grading function, which runs as the service role, still reads it.
revoke select, update on public.quiz_questions from anon, authenticated;
grant select (
  id, quiz_id, user_id, position, question_type, stem, options, explanation, chunk_id, points
), update (
  id, quiz_id, user_id, position, question_type, stem, options, explanation, chunk_id, points
) on public.quiz_questions to authenticated;

-- One review is one transaction: the append-only log and the schedule it
-- describes can never disagree. Runs as the caller, so RLS decides whose card
-- this is.
create or replace function public.review_card(
  p_card_id uuid,
  p_rating smallint,
  p_state public.card_state,
  p_stability double precision,
  p_difficulty double precision,
  p_reps integer,
  p_lapses integer,
  p_due_at timestamptz,
  p_elapsed_ms integer default null
)
returns public.card_schedule
language plpgsql
set search_path = public
as $$
declare
  previous public.card_schedule;
  updated public.card_schedule;
begin
  select * into previous from public.card_schedule where card_id = p_card_id;
  if not found then
    raise exception 'card % has no schedule', p_card_id using errcode = 'no_data_found';
  end if;

  update public.card_schedule
     set state          = p_state,
         stability      = p_stability,
         difficulty     = p_difficulty,
         reps           = p_reps,
         lapses         = p_lapses,
         due_at         = p_due_at,
         last_review_at = now()
   where card_id = p_card_id
  returning * into updated;

  insert into public.review_logs (
    user_id, card_id, rating, elapsed_ms, prev_due_at, next_due_at, prev_state
  )
  values (
    previous.user_id, p_card_id, p_rating, p_elapsed_ms, previous.due_at, p_due_at, previous.state
  );

  return updated;
end;
$$;

revoke execute on function public.review_card(
  uuid, smallint, public.card_state, double precision, double precision, integer, integer, timestamptz, integer
) from public, anon;
grant execute on function public.review_card(
  uuid, smallint, public.card_state, double precision, double precision, integer, integer, timestamptz, integer
) to authenticated, service_role;
