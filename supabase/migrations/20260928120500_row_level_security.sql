-- AI Study Assistant — Row Level Security.
--
-- Authorisation model in one sentence: the client never sends a user id, every
-- row stores its owner, and a policy compares that owner to auth.uid() taken
-- from the verified JWT. Server-side work runs under the service role, which
-- bypasses RLS and is only ever used inside Edge Functions.
--
-- Three shapes of table:
--   1. fully owner-writable  — the student's own content;
--   2. owner-readable only   — rows the pipeline writes (chunks, jobs, usage);
--   3. append-only for owner — review_logs, which analytics depend on.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'subjects', 'documents', 'document_chunks', 'summaries',
    'decks', 'cards', 'card_schedule', 'review_logs',
    'quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers',
    'study_plans', 'plan_items', 'study_sessions',
    'chat_threads', 'chat_messages', 'message_citations',
    'ingestion_jobs', 'ai_usage'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- profiles: the owner is the primary key itself. There is no insert policy —
-- the row is created by the on_auth_user_created trigger — and no delete
-- policy, because deleting the profile is deleting the account.
create policy "Owners can read their profile"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

create policy "Owners can update their profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Fully owner-writable tables. The bodies are identical, so they are generated
-- here rather than copied, which makes an omission impossible.
do $$
declare
  t text;
begin
  foreach t in array array[
    'subjects', 'documents', 'summaries',
    'decks', 'cards', 'card_schedule',
    'quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_answers',
    'study_plans', 'plan_items', 'study_sessions',
    'chat_threads', 'chat_messages', 'message_citations'
  ]
  loop
    execute format(
      'create policy "Owners can read their %1$s" on public.%1$I
         for select to authenticated using (auth.uid() = user_id)', t);
    execute format(
      'create policy "Owners can insert their %1$s" on public.%1$I
         for insert to authenticated with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "Owners can update their %1$s" on public.%1$I
         for update to authenticated using (auth.uid() = user_id)
         with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "Owners can delete their %1$s" on public.%1$I
         for delete to authenticated using (auth.uid() = user_id)', t);
  end loop;
end;
$$;

-- Pipeline-owned tables: readable by the owner, written only by the service
-- role inside Edge Functions. A client cannot forge an embedding, replay a job
-- or edit its own usage ledger.
do $$
declare
  t text;
begin
  foreach t in array array['document_chunks', 'ingestion_jobs', 'ai_usage']
  loop
    execute format(
      'create policy "Owners can read their %1$s" on public.%1$I
         for select to authenticated using (auth.uid() = user_id)', t);
  end loop;
end;
$$;

-- review_logs is append-only: the owner may read and add, never rewrite.
create policy "Owners can read their review_logs"
  on public.review_logs for select to authenticated
  using (auth.uid() = user_id);

create policy "Owners can insert their review_logs"
  on public.review_logs for insert to authenticated
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Restrictive parent checks
-- ---------------------------------------------------------------------------
-- The owner column alone would let a caller attach a correctly-owned child row
-- to somebody else's parent by guessing its id. These restrictive policies
-- close that off: the parent must also be owned by the caller. They combine
-- with the permissive policies above using AND.

create policy "Child rows must hang off an owned parent"
  on public.chat_messages as restrictive for all to authenticated
  using (exists (select 1 from public.chat_threads p where p.id = thread_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.chat_threads p where p.id = thread_id and p.user_id = auth.uid()));

create policy "Citations must hang off an owned message"
  on public.message_citations as restrictive for all to authenticated
  using (exists (select 1 from public.chat_messages p where p.id = message_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.chat_messages p where p.id = message_id and p.user_id = auth.uid()));

create policy "Cards must hang off an owned deck"
  on public.cards as restrictive for all to authenticated
  using (exists (select 1 from public.decks p where p.id = deck_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.decks p where p.id = deck_id and p.user_id = auth.uid()));

create policy "Questions must hang off an owned quiz"
  on public.quiz_questions as restrictive for all to authenticated
  using (exists (select 1 from public.quizzes p where p.id = quiz_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.quizzes p where p.id = quiz_id and p.user_id = auth.uid()));

create policy "Answers must hang off an owned attempt"
  on public.quiz_answers as restrictive for all to authenticated
  using (exists (select 1 from public.quiz_attempts p where p.id = attempt_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.quiz_attempts p where p.id = attempt_id and p.user_id = auth.uid()));

create policy "Plan items must hang off an owned plan"
  on public.plan_items as restrictive for all to authenticated
  using (exists (select 1 from public.study_plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.study_plans p where p.id = plan_id and p.user_id = auth.uid()));

create policy "Summaries must hang off an owned document"
  on public.summaries as restrictive for all to authenticated
  using (exists (select 1 from public.documents p where p.id = document_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.documents p where p.id = document_id and p.user_id = auth.uid()));

-- Documents, decks, quizzes and plans may reference a subject; it must be the
-- caller's own subject.
do $$
declare
  t text;
begin
  foreach t in array array['documents', 'decks', 'quizzes', 'study_plans', 'study_sessions']
  loop
    execute format(
      'create policy "%1$s must reference an owned subject" on public.%1$I
         as restrictive for all to authenticated
         using (subject_id is null or exists (
           select 1 from public.subjects s where s.id = subject_id and s.user_id = auth.uid()))
         with check (subject_id is null or exists (
           select 1 from public.subjects s where s.id = subject_id and s.user_id = auth.uid()))', t);
  end loop;
end;
$$;
