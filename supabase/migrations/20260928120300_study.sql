-- AI Study Assistant — the study loop.
--
-- decks ── cards ── card_schedule (1:1, FSRS state)
--                └── review_logs (append-only history)
-- quizzes ── quiz_questions
--        └── quiz_attempts ── quiz_answers
-- study_plans ── plan_items
-- study_sessions
--
-- Card *content* and card *scheduling* are deliberately separate tables: a card
-- can be regenerated or edited without resetting the student's progress.

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index decks_user_idx on public.decks (user_id);

create trigger decks_set_updated_at
  before update on public.decks
  for each row execute function public.set_updated_at();

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  deck_id uuid not null references public.decks (id) on delete cascade,
  -- Provenance. Keeping the chunk lets the review UI show the exact passage the
  -- card came from, and lets the generator reject anything ungrounded.
  document_id uuid references public.documents (id) on delete set null,
  chunk_id uuid references public.document_chunks (id) on delete set null,
  card_type public.card_type not null default 'basic',
  front text not null check (char_length(trim(front)) > 0),
  back text not null check (char_length(trim(back)) > 0),
  source_quote text,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_deck_idx on public.cards (deck_id);
create index cards_user_idx on public.cards (user_id);
create index cards_document_idx on public.cards (document_id) where document_id is not null;

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- FSRS state, one row per card, created by a trigger so a new card is always
-- immediately reviewable.
create table public.card_schedule (
  card_id uuid primary key references public.cards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  state public.card_state not null default 'new',
  due_at timestamptz not null default now(),
  stability double precision not null default 0 check (stability >= 0),
  difficulty double precision not null default 0 check (difficulty between 0 and 10),
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  last_review_at timestamptz,
  updated_at timestamptz not null default now()
);

-- The review queue query: "my cards that are due, soonest first".
create index card_schedule_due_idx on public.card_schedule (user_id, due_at);

create trigger card_schedule_set_updated_at
  before update on public.card_schedule
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.card_schedule (card_id, user_id)
  values (new.id, new.user_id)
  on conflict (card_id) do nothing;
  return new;
end;
$$;

create trigger on_card_created
  after insert on public.cards
  for each row execute function public.handle_new_card();

-- Append-only: the source for retention analytics and for re-tuning the
-- scheduler later. Never updated or deleted by the application.
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  card_id uuid not null references public.cards (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  rating smallint not null check (rating between 1 and 4), -- again / hard / good / easy
  elapsed_ms integer check (elapsed_ms is null or elapsed_ms >= 0),
  prev_due_at timestamptz,
  next_due_at timestamptz not null,
  prev_state public.card_state
);

create index review_logs_user_time_idx on public.review_logs (user_id, reviewed_at desc);
create index review_logs_card_idx on public.review_logs (card_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- quizzes
-- ---------------------------------------------------------------------------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  difficulty text not null default 'mixed' check (difficulty in ('easy', 'medium', 'hard', 'mixed')),
  generated_by_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quizzes_user_idx on public.quizzes (user_id, created_at desc);

create trigger quizzes_set_updated_at
  before update on public.quizzes
  for each row execute function public.set_updated_at();

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null check (position >= 1),
  question_type public.question_type not null,
  stem text not null check (char_length(trim(stem)) > 0),
  -- ["Ottawa", "Toronto", ...] for mcq, null otherwise.
  options jsonb,
  correct_answer text not null,
  explanation text,
  chunk_id uuid references public.document_chunks (id) on delete set null,
  points smallint not null default 1 check (points > 0),
  unique (quiz_id, position),
  constraint quiz_questions_mcq_options
    check (question_type <> 'mcq' or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8))
);

create index quiz_questions_quiz_idx on public.quiz_questions (quiz_id, position);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quiz_id uuid not null references public.quizzes (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric(6, 2) check (score is null or score >= 0),
  max_score numeric(6, 2) check (max_score is null or max_score >= 0),
  constraint quiz_attempts_scored_only_when_submitted
    check (submitted_at is not null or (score is null and max_score is null))
);

create index quiz_attempts_user_idx on public.quiz_attempts (user_id, started_at desc);
create index quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id);

create table public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts (id) on delete cascade,
  question_id uuid not null references public.quiz_questions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  response text,
  is_correct boolean,
  score numeric(6, 2),
  feedback text,
  answered_at timestamptz not null default now(),
  -- One answer per question per attempt; re-answering updates the row.
  unique (attempt_id, question_id)
);

create index quiz_answers_user_idx on public.quiz_answers (user_id);

-- ---------------------------------------------------------------------------
-- planner and study sessions
-- ---------------------------------------------------------------------------
create table public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  goal text not null check (char_length(trim(goal)) > 0),
  exam_date date,
  daily_minutes integer not null default 60 check (daily_minutes between 5 and 1440),
  generated_by_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index study_plans_user_idx on public.study_plans (user_id, created_at desc);

create trigger study_plans_set_updated_at
  before update on public.study_plans
  for each row execute function public.set_updated_at();

-- A generated plan is stored as ordinary rows, not as frozen model text, so the
-- student can edit, reschedule and tick items off.
create table public.plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  scheduled_for date not null,
  position integer not null default 1 check (position >= 1),
  activity public.plan_activity not null,
  title text not null check (char_length(trim(title)) > 0),
  document_id uuid references public.documents (id) on delete set null,
  deck_id uuid references public.decks (id) on delete set null,
  estimated_minutes integer not null default 30 check (estimated_minutes between 5 and 600),
  completed_at timestamptz
);

create index plan_items_plan_idx on public.plan_items (plan_id, scheduled_for, position);
create index plan_items_user_day_idx on public.plan_items (user_id, scheduled_for);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject_id uuid references public.subjects (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  activity public.plan_activity not null default 'read',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  minutes integer check (minutes is null or minutes >= 0),
  notes text,
  constraint study_sessions_time_order check (ended_at is null or ended_at >= started_at)
);

create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);
