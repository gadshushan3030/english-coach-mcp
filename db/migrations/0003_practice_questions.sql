-- Model-authored questions, answered from their saved canonical choices.
-- All calls use an authenticated user id supplied by trusted server code. These
-- SECURITY INVOKER functions do not authenticate arbitrary database connections.
-- Composite foreign keys also reject cross-user links made with direct SQL.
-- Historical checked exercises remain response_format = 'unspecified'.

-- Match the whitespace trimmed by JavaScript String.trim at the API boundary.
create function trim_practice_text(p_text text)
returns text
language sql
immutable
strict
as $$
  select btrim(p_text, E' \t\n\r\f\013' || U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff')
$$;

create function valid_practice_choices(p_choices jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v_choice jsonb;
  v_text text;
  v_seen text[] := '{}';
begin
  if p_choices is null or jsonb_typeof(p_choices) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_choices) <> 3 then
    return false;
  end if;
  for v_choice in select value from jsonb_array_elements(p_choices)
  loop
    if jsonb_typeof(v_choice) <> 'string' then
      return false;
    end if;
    v_text := v_choice #>> '{}';
    if char_length(v_text) not between 1 and 500
       or v_text <> trim_practice_text(v_text)
       or lower(v_text) = any(v_seen) then
      return false;
    end if;
    v_seen := array_append(v_seen, lower(v_text));
  end loop;
  return true;
end;
$$;

alter table practice_sessions add constraint practice_sessions_id_user_unique unique (id, user_id);
alter table words add constraint words_id_user_unique unique (id, user_id);
alter table exercises add constraint exercises_id_user_unique unique (id, user_id);

create table practice_questions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100 and request_id = trim_practice_text(request_id)),
  question text not null check (char_length(question) between 1 and 500 and question = trim_practice_text(question)),
  choices jsonb not null check (valid_practice_choices(choices)),
  correct_index smallint not null check (correct_index between 0 and 2),
  explanation_he text not null check (char_length(explanation_he) between 1 and 500 and explanation_he = trim_practice_text(explanation_he) and explanation_he ~ '[א-ת]'),
  original text not null check (char_length(original) between 1 and 500 and original = trim_practice_text(original)),
  source_session_id uuid,
  word_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  answered_at timestamptz,
  selected_index smallint check (selected_index between 0 and 2),
  exercise_id uuid unique,
  unique (user_id, request_id),
  unique (id, user_id),
  foreign key (source_session_id, user_id) references practice_sessions (id, user_id) on delete set null (source_session_id),
  foreign key (word_id, user_id) references words (id, user_id) on delete set null (word_id),
  foreign key (exercise_id, user_id) references exercises (id, user_id),
  check (
    (answered_at is null and selected_index is null and exercise_id is null)
    or (answered_at is not null and selected_index is not null and exercise_id is not null)
  )
);
create index practice_questions_pending_idx on practice_questions (user_id, created_at, id) where answered_at is null;
create index practice_questions_source_idx on practice_questions (source_session_id);
comment on table practice_questions is 'Saved model-authored multiple-choice questions. First checked answer is authoritative.';
comment on column practice_questions.source_session_id is 'Source conversation provenance only; a later recognition attempt is not evidence of production in that conversation.';

alter table exercises
  add column response_format text not null default 'unspecified'
    check (response_format in ('unspecified', 'multiple_choice', 'free_response')),
  add column question_id uuid unique,
  add column selected_index smallint check (selected_index between 0 and 2),
  add foreign key (question_id, user_id) references practice_questions (id, user_id),
  add check (
    (question_id is null and selected_index is null)
    or (question_id is not null and selected_index is not null and response_format = 'multiple_choice')
  );
comment on column exercises.response_format is 'Answer-production format. Historical rows are unspecified; recognition must not be reported as free-response ability.';

-- Replace the old signature rather than creating an ambiguous overload. Its
-- existing positional callers still work through the final argument's default.
drop function record_exercise(text, text, text, text, text, text, integer, uuid, text, text);

create function record_exercise(
  p_user_id text,
  p_request_id text,
  p_question text,
  p_answer text,
  p_result text,
  p_expected text default null,
  p_attempt integer default null,
  p_session_id uuid default null,
  p_word text default null,
  p_checked_by text default 'assistant',
  p_response_format text default 'unspecified'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_word uuid;
begin
  select id into v_id from exercises where user_id = p_user_id and request_id = p_request_id;
  if v_id is not null then
    return v_id;
  end if;

  if p_session_id is not null
     and not exists (select 1 from practice_sessions where id = p_session_id and user_id = p_user_id) then
    raise exception 'practice session not found';
  end if;

  if p_word is not null then
    select id into v_word from words
    where user_id = p_user_id and lower(english) = lower(trim(p_word))
    order by (english = trim(p_word)) desc, id limit 1;
    if v_word is null then
      raise exception 'unknown word: %. Add it with add_words first.', p_word;
    end if;
  end if;

  insert into exercises
    (user_id, request_id, session_id, word_id, question, answer, expected, result, attempt, checked_by, response_format)
  values (
    p_user_id, p_request_id, p_session_id, v_word, p_question, p_answer, p_expected, p_result,
    coalesce(p_attempt, 1 + (
      select count(*) from exercises e
      where e.user_id = p_user_id and e.question = p_question
        and e.session_id is not distinct from p_session_id)),
    p_checked_by, p_response_format
  )
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from exercises where user_id = p_user_id and request_id = p_request_id;
    return v_id;
  end if;

  if v_word is not null then
    update words set
      box = case p_result when 'correct' then least(box + 1, 6) when 'incorrect' then 0 else box end,
      due_at = now() + box_interval(
        case p_result when 'correct' then least(box + 1, 6) when 'incorrect' then 0 else greatest(box, 1) end)
    where id = v_word;
  end if;

  return v_id;
end;
$$;


create or replace function finish_practice(
  p_user_id text,
  p_session_id uuid,
  p_sentences jsonb default '[]',
  p_corrections jsonb default '[]',
  p_new_words jsonb default '[]',
  p_comprehension smallint default null,
  p_vocabulary smallint default null,
  p_grammar smallint default null,
  p_pronunciation smallint default null,
  p_feedback text default null,
  p_exercises jsonb default '[]',
  p_checked_by text default 'assistant'
)
returns uuid
language plpgsql
as $$
declare
  x record;
begin
  update practice_sessions set
    sentences = p_sentences,
    corrections = p_corrections,
    new_words = p_new_words,
    comprehension = p_comprehension,
    vocabulary = p_vocabulary,
    grammar = p_grammar,
    pronunciation = p_pronunciation,
    feedback = p_feedback,
    completed_at = coalesce(completed_at, now())
  where id = p_session_id and user_id = p_user_id;

  if not found then
    raise exception 'practice session not found';
  end if;

  insert into words (user_id, english, hebrew, example)
  select p_user_id, trim(w.english), trim(w.hebrew), nullif(trim(w.example), '')
  from jsonb_to_recordset(p_new_words) as w(english text, hebrew text, example text)
  on conflict (user_id, english) do nothing;

  for x in
    select * from jsonb_to_recordset(p_exercises) as e(
      request_id text, question text, answer text, result text,
      expected text, attempt integer, word text, response_format text)
  loop
    perform record_exercise(
      p_user_id, x.request_id, x.question, x.answer, x.result, x.expected, x.attempt,
      p_session_id, x.word, p_checked_by, coalesce(x.response_format, 'unspecified'));
  end loop;

  return p_session_id;
end;
$$;

-- Prevent later content edits from changing the meaning of an already queued
-- question, and prevent rewriting the first checked answer. Cleared provenance
-- and word links are permitted so their ON DELETE SET NULL actions still work.
create function guard_practice_question()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.user_id, new.request_id, new.question, new.choices,
           new.correct_index, new.explanation_he, new.original, new.created_at)
       is distinct from
       row(old.id, old.user_id, old.request_id, old.question, old.choices,
           old.correct_index, old.explanation_he, old.original, old.created_at)
       or (new.source_session_id is distinct from old.source_session_id and new.source_session_id is not null)
       or (new.word_id is distinct from old.word_id and new.word_id is not null) then
      raise exception 'queued question content is immutable';
    end if;
    if old.exercise_id is not null and
       row(new.exercise_id, new.selected_index, new.answered_at)
       is distinct from row(old.exercise_id, old.selected_index, old.answered_at) then
      raise exception 'first question answer is immutable';
    end if;
  end if;
  if new.exercise_id is not null and not exists (
    select 1 from exercises e
    where e.id = new.exercise_id and e.user_id = new.user_id
      and e.question_id = new.id and e.selected_index = new.selected_index
      and e.response_format = 'multiple_choice'
  ) then
    raise exception 'question answer must reference its canonical exercise';
  end if;
  return new;
end;
$$;
create trigger practice_question_guard before insert or update on practice_questions
for each row execute function guard_practice_question();

-- SQL callers cannot attach an invented outcome, option, or source-session
-- attribution to a queued question. Once linked, its checked result is fixed.
create function guard_practice_question_exercise()
returns trigger
language plpgsql
as $$
declare
  q practice_questions%rowtype;
begin
  if tg_op = 'UPDATE' and old.question_id is not null then
    if row(new.id, new.user_id, new.request_id, new.session_id, new.question,
           new.answer, new.expected, new.result, new.attempt, new.checked_by,
           new.response_format, new.question_id, new.selected_index, new.created_at)
       is distinct from
       row(old.id, old.user_id, old.request_id, old.session_id, old.question,
           old.answer, old.expected, old.result, old.attempt, old.checked_by,
           old.response_format, old.question_id, old.selected_index, old.created_at)
       or (new.word_id is distinct from old.word_id and new.word_id is not null) then
      raise exception 'first question exercise is immutable';
    end if;
    -- A deleted word may clear the optional link without changing the answer.
    return new;
  end if;
  if new.question_id is not null then
    select * into q from practice_questions
    where id = new.question_id and user_id = new.user_id
    for update;
    if not found then
      raise exception 'practice question not found';
    end if;
    if new.selected_index is null or new.selected_index not between 0 and 2
       or new.response_format <> 'multiple_choice'
       or new.request_id <> 'practice_question:' || q.id::text
       or new.question <> q.question
       or new.answer <> q.choices ->> new.selected_index
       or new.expected is distinct from (q.choices ->> q.correct_index)
       or new.result <> (case when new.selected_index = q.correct_index then 'correct' else 'incorrect' end)
       or new.session_id is not null
       or new.word_id is distinct from q.word_id
       or new.checked_by <> 'app' or new.attempt <> 1
       or (q.exercise_id is not null and q.exercise_id <> new.id) then
      raise exception 'exercise must match the saved question and selected choice';
    end if;
  end if;
  return new;
end;
$$;
create trigger practice_question_exercise_guard before insert or update on exercises
for each row execute function guard_practice_question_exercise();

create function queue_practice_question(
  p_user_id text,
  p_request_id text,
  p_question text,
  p_choices jsonb,
  p_correct_index integer,
  p_explanation_he text,
  p_original text,
  p_source_session_id uuid default null,
  p_word text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_word uuid;
begin
  -- A replay returns the original, immutable question even if payload changed.
  select id into v_id from practice_questions
  where user_id = p_user_id and request_id = p_request_id;
  if v_id is not null then
    return v_id;
  end if;
  if p_source_session_id is not null and not exists (
    select 1 from practice_sessions where id = p_source_session_id and user_id = p_user_id
  ) then
    raise exception 'practice session not found';
  end if;
  if p_word is not null then
    select id into v_word from words
    where user_id = p_user_id and lower(english) = lower(trim(p_word))
    order by (english = trim(p_word)) desc, id limit 1;
    if v_word is null then
      raise exception 'unknown word: %. Add it with add_words first.', p_word;
    end if;
  end if;
  insert into practice_questions
    (user_id, request_id, question, choices, correct_index, explanation_he, original, source_session_id, word_id)
  values
    (p_user_id, p_request_id, p_question, p_choices, p_correct_index,
     p_explanation_he, p_original, p_source_session_id, v_word)
  on conflict (user_id, request_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from practice_questions
    where user_id = p_user_id and request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

create function answer_practice_question(
  p_user_id text,
  p_question_id uuid,
  p_selected_index integer
)
returns uuid
language plpgsql
as $$
declare
  q practice_questions%rowtype;
  v_exercise uuid;
  v_word text;
  v_request_id text;
begin
  if p_selected_index is null or p_selected_index not between 0 and 2 then
    raise exception 'selected_index must be 0, 1, or 2';
  end if;
  select * into q from practice_questions
  where id = p_question_id and user_id = p_user_id
  for update;
  if not found then
    raise exception 'practice question not found';
  end if;
  -- The lock lasts through grading, the exercise write, scheduling, and marking
  -- answered. Concurrent or conflicting retries return the same first result.
  if q.exercise_id is not null then
    return q.exercise_id;
  end if;
  v_request_id := 'practice_question:' || q.id::text;
  -- Do not adopt an unrelated caller-created exercise using the reserved id.
  if exists (select 1 from exercises where user_id = p_user_id and request_id = v_request_id) then
    raise exception 'practice question request id already used';
  end if;
  if q.word_id is not null then
    -- Hold the word link stable through record_exercise and its schedule update.
    select english into v_word from words
    where id = q.word_id and user_id = p_user_id for update;
  end if;
  v_exercise := record_exercise(
    p_user_id, v_request_id, q.question, q.choices ->> p_selected_index,
    case when p_selected_index = q.correct_index then 'correct' else 'incorrect' end,
    q.choices ->> q.correct_index, 1, null, v_word, 'app', 'multiple_choice'
  );
  update exercises set question_id = q.id, selected_index = p_selected_index
  where id = v_exercise and user_id = p_user_id;
  update practice_questions set
    selected_index = p_selected_index, exercise_id = v_exercise, answered_at = clock_timestamp()
  where id = q.id and user_id = p_user_id;
  return v_exercise;
end;
$$;
