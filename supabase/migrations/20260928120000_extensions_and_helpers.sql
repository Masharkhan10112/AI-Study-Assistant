-- AI Study Assistant — extensions, enums and shared helpers.
--
-- Everything the rest of the schema depends on lives here so that the later
-- migrations only contain tables, policies and functions.

create extension if not exists "pgcrypto";
-- Vector similarity search over document chunks.
create extension if not exists "vector" with schema extensions;
-- Trigram matching, used by the lexical half of hybrid retrieval.
create extension if not exists "pg_trgm" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.document_source as enum ('pdf', 'docx', 'pptx', 'txt', 'markdown', 'image', 'paste');
create type public.document_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.summary_style as enum ('brief', 'detailed', 'outline');
create type public.card_type as enum ('basic', 'cloze');
create type public.card_state as enum ('new', 'learning', 'review', 'relearning');
create type public.question_type as enum ('mcq', 'true_false', 'short_answer');
create type public.plan_activity as enum ('read', 'review', 'quiz', 'practice');
create type public.chat_role as enum ('user', 'assistant', 'system');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
