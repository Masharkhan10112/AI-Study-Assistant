-- AI Study Assistant — profiles.
--
-- profiles.id *is* auth.users.id: the application never stores a second user
-- identity, and every other table's user_id points at this table, so deleting
-- an auth user cascades through the whole schema.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  avatar_url text,
  timezone text not null default 'UTC',
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  -- Study preferences used by the planner and the review queue builder.
  daily_review_target integer not null default 40 check (daily_review_target between 0 and 1000),
  daily_study_minutes_target integer not null default 60 check (daily_study_minutes_target between 0 and 1440),
  -- Hard ceiling on AI spend: checked by the Edge Functions before any model call.
  ai_daily_token_cap integer not null default 200000 check (ai_daily_token_cap >= 0),
  ai_preferences jsonb not null default
    '{"detail_level": "balanced", "tone": "friendly", "language": "en"}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- A profile row must exist before any other insert can reference it, so it is
-- created by a trigger on auth.users rather than by the client. Sign-up metadata
-- carries the display name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, timezone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep the denormalised email in step with auth.users after an email change.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = coalesce(new.email, '')
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();
