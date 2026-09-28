-- Local development seed data.
-- Creates one demo student (demo@studyai.test / studyai-2026) with a subject,
-- an ingested document with embedded chunks, a deck, a quiz and a study plan,
-- so the retrieval and review flows have something to work against.
-- Never run this against a hosted project.

do $$
declare
  demo_user uuid := '11111111-1111-4111-8111-111111111111';
  subject_os uuid := '22222222-2222-4222-8222-222222222201';
  subject_db uuid := '22222222-2222-4222-8222-222222222202';
  doc_scheduling uuid := '33333333-3333-4333-8333-333333333301';
  doc_indexes uuid := '33333333-3333-4333-8333-333333333302';
  chunk_a uuid := '44444444-4444-4444-8444-444444444401';
  chunk_b uuid := '44444444-4444-4444-8444-444444444402';
  chunk_c uuid := '44444444-4444-4444-8444-444444444403';
  deck_os uuid := '55555555-5555-4555-8555-555555555501';
  quiz_os uuid := '66666666-6666-4666-8666-666666666601';
  plan_finals uuid := '77777777-7777-4777-8777-777777777701';
  card_rr uuid := '88888888-8888-4888-8888-888888888801';
begin
  if exists (select 1 from auth.users where id = demo_user) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
    email_change, phone_change, phone_change_token, reauthentication_token
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    demo_user,
    'authenticated',
    'authenticated',
    'demo@studyai.test',
    crypt('studyai-2026', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', 'Ayesha Khan', 'timezone', 'Asia/Karachi'),
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(),
    demo_user,
    demo_user::text,
    jsonb_build_object('sub', demo_user::text, 'email', 'demo@studyai.test', 'email_verified', true),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.subjects (id, user_id, name, description, color)
  values
    (subject_os, demo_user, 'Operating Systems', 'CS-321 lecture notes and past papers.', '#2563eb'),
    (subject_db, demo_user, 'Database Systems', 'CS-311 notes, indexing and transactions.', '#16a34a');

  -- Documents are inserted as already-ingested so the seed does not depend on
  -- the ingestion worker running; the trigger only enqueues 'pending' rows.
  insert into public.documents (
    id, user_id, subject_id, title, source_type, storage_path, mime_type,
    byte_size, page_count, checksum, status, ingested_at
  )
  values
    (
      doc_scheduling, demo_user, subject_os, 'Lecture 4 — CPU scheduling', 'pdf',
      demo_user::text || '/' || doc_scheduling::text || '/source.pdf', 'application/pdf',
      482301, 18, 'seed-checksum-scheduling', 'ready', now() - interval '3 days'
    ),
    (
      doc_indexes, demo_user, subject_db, 'Lecture 7 — B-tree indexes', 'pdf',
      demo_user::text || '/' || doc_indexes::text || '/source.pdf', 'application/pdf',
      377145, 14, 'seed-checksum-indexes', 'ready', now() - interval '1 day'
    );

  -- Embeddings are left null: a real vector needs the embedding model, and the
  -- lexical half of hybrid_search_chunks works without one.
  insert into public.document_chunks (id, document_id, user_id, chunk_index, content, token_count, page_from, page_to, heading)
  values
    (
      chunk_a, doc_scheduling, demo_user, 0,
      'Round robin scheduling assigns each process a fixed time quantum and cycles through the ready queue. '
      'A short quantum improves response time but increases context switching overhead.',
      42, 3, 3, 'Round robin'
    ),
    (
      chunk_b, doc_scheduling, demo_user, 1,
      'Shortest job first minimises average waiting time but requires knowing the burst time in advance, '
      'and can starve long processes when short jobs keep arriving.',
      38, 5, 5, 'Shortest job first'
    ),
    (
      chunk_c, doc_indexes, demo_user, 0,
      'A B-tree index keeps keys sorted and balanced, so a lookup costs O(log n) page reads. '
      'Range scans are cheap because leaf nodes are linked in key order.',
      40, 2, 2, 'B-tree basics'
    );

  insert into public.summaries (user_id, document_id, style, content_md, model)
  values (
    demo_user, doc_scheduling, 'brief',
    '- Round robin trades context-switch overhead for responsiveness.' || chr(10) ||
    '- SJF is optimal for average waiting time but needs burst times and can starve long jobs.',
    'seed'
  );

  insert into public.decks (id, user_id, subject_id, name, description)
  values (deck_os, demo_user, subject_os, 'OS — scheduling', 'Cards generated from lecture 4.');

  insert into public.cards (id, user_id, deck_id, document_id, chunk_id, card_type, front, back, source_quote)
  values
    (
      card_rr, demo_user, deck_os, doc_scheduling, chunk_a, 'basic',
      'What does the time quantum control in round robin scheduling?',
      'How long each process runs before it is preempted — shorter quanta improve response time but add context-switch overhead.',
      'Round robin scheduling assigns each process a fixed time quantum.'
    ),
    (
      gen_random_uuid(), demo_user, deck_os, doc_scheduling, chunk_b, 'basic',
      'Why can shortest job first starve processes?',
      'A steady stream of short jobs keeps preempting long ones, so a long process may never be selected.',
      'SJF can starve long processes when short jobs keep arriving.'
    );

  -- One card already reviewed, so the progress views have history to show.
  update public.card_schedule
     set state = 'review', due_at = now() + interval '2 days', stability = 4.2,
         difficulty = 5.1, reps = 3, lapses = 0, last_review_at = now() - interval '1 day'
   where card_id = card_rr;

  insert into public.review_logs (user_id, card_id, reviewed_at, rating, elapsed_ms, prev_due_at, next_due_at, prev_state)
  values (demo_user, card_rr, now() - interval '1 day', 3, 7400, now() - interval '1 day', now() + interval '2 days', 'learning');

  insert into public.quizzes (id, user_id, subject_id, document_id, title, difficulty, generated_by_model)
  values (quiz_os, demo_user, subject_os, doc_scheduling, 'Scheduling — quick check', 'medium', 'seed');

  insert into public.quiz_questions (quiz_id, user_id, position, question_type, stem, options, correct_answer, explanation, chunk_id)
  values
    (
      quiz_os, demo_user, 1, 'mcq',
      'Which scheduling algorithm minimises average waiting time?',
      '["First come first served", "Shortest job first", "Round robin", "Priority with aging"]'::jsonb,
      'Shortest job first',
      'SJF is provably optimal for average waiting time when burst times are known.',
      chunk_b
    ),
    (
      quiz_os, demo_user, 2, 'true_false',
      'A shorter round robin quantum always improves overall throughput.',
      null,
      'false',
      'A shorter quantum improves response time but the extra context switches reduce throughput.',
      chunk_a
    );

  insert into public.study_plans (id, user_id, subject_id, goal, exam_date, daily_minutes, generated_by_model)
  values (plan_finals, demo_user, subject_os, 'Pass the OS final with a solid grasp of scheduling and memory management.', current_date + 21, 90, 'seed');

  insert into public.plan_items (plan_id, user_id, scheduled_for, position, activity, title, document_id, deck_id, estimated_minutes)
  values
    (plan_finals, demo_user, current_date, 1, 'read', 'Re-read lecture 4 on scheduling', doc_scheduling, null, 40),
    (plan_finals, demo_user, current_date, 2, 'review', 'Review the OS scheduling deck', null, deck_os, 20),
    (plan_finals, demo_user, current_date + 1, 1, 'quiz', 'Take the scheduling quick check', doc_scheduling, null, 15);

  insert into public.study_sessions (user_id, subject_id, document_id, activity, started_at, ended_at, minutes)
  values
    (demo_user, subject_os, doc_scheduling, 'read', now() - interval '2 days', now() - interval '2 days' + interval '50 minutes', 50),
    (demo_user, subject_db, doc_indexes, 'read', now() - interval '1 day', now() - interval '1 day' + interval '35 minutes', 35);

  insert into public.ai_usage (user_id, usage_date, function_name, model, requests, prompt_tokens, completion_tokens, cost_cents)
  values (demo_user, current_date, 'ai-chat', 'gpt-4o-mini', 6, 8400, 1900, 0.42);
end;
$$;
