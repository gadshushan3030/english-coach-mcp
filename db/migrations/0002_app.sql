-- Learning data for a single-owner English app.
--
-- Only server code talks to this database (connection string lives in Vercel env),
-- and every query and function is scoped to the owner's user id.
--
-- Two kinds of evidence are kept apart on purpose:
--   reviews   = self-assessment from the flashcards ("I know" / "need practice")
--   exercises = answers that were actually checked (by the app or by the assistant)
--
-- Every write takes a caller-chosen request_id; replaying the same request returns
-- the existing row instead of creating a duplicate.

create table words (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  english text not null check (char_length(english) between 1 and 100),
  hebrew text not null check (char_length(hebrew) between 1 and 100),
  example text check (char_length(example) <= 300),
  status text not null default 'new' check (status in ('new', 'practice', 'known')),
  -- Familiarity level 0-6; doubles as the spaced-repetition box.
  box smallint not null default 0 check (box between 0 and 6),
  due_at timestamptz not null default now(),
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, english)
);
create index words_user_due_idx on words (user_id, due_at);

create table reviews (
  id bigint generated always as identity primary key,
  user_id text not null references "user" (id) on delete cascade,
  word_id uuid not null references words on delete cascade,
  knew boolean not null,
  reviewed_at timestamptz not null default now()
);
comment on table reviews is 'Self-assessment marks from the flashcards. Not a checked answer.';

create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  source text not null default 'assistant' check (source in ('assistant', 'app')),
  mode text not null default 'text' check (mode in ('text', 'voice')),
  topic text not null check (char_length(topic) between 1 and 200),
  level text not null check (level in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  day date not null default (now() at time zone 'Asia/Jerusalem')::date,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- [{ "en": "...", "he": "..." }]
  sentences jsonb not null default '[]' check (jsonb_typeof(sentences) = 'array'),
  -- [{ "original": "...", "corrected": "...", "note": "..." }]
  corrections jsonb not null default '[]' check (jsonb_typeof(corrections) = 'array'),
  -- [{ "english": "...", "hebrew": "...", "example": "..." }]
  new_words jsonb not null default '[]' check (jsonb_typeof(new_words) = 'array'),
  -- Fixed rubric, 1-5. Pronunciation only exists for spoken practice.
  comprehension smallint check (comprehension between 1 and 5),
  vocabulary smallint check (vocabulary between 1 and 5),
  grammar smallint check (grammar between 1 and 5),
  pronunciation smallint check (pronunciation between 1 and 5),
  feedback text check (char_length(feedback) <= 1000),
  check (pronunciation is null or mode = 'voice'),
  unique (user_id, request_id)
);
create index practice_sessions_user_day_idx on practice_sessions (user_id, day desc);

create table exercises (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  session_id uuid references practice_sessions on delete cascade,
  word_id uuid references words on delete set null,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) <= 1000),
  expected text check (char_length(expected) <= 500),
  result text not null check (result in ('correct', 'partial', 'incorrect')),
  attempt smallint not null default 1 check (attempt >= 1),
  checked_by text not null check (checked_by in ('assistant', 'app')),
  -- clock_timestamp, not now(): exercises saved in one call keep their order.
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id)
);
create index exercises_user_time_idx on exercises (user_id, created_at desc);
create index exercises_session_idx on exercises (session_id);
create index exercises_word_idx on exercises (word_id);
comment on table exercises is 'Checked answers only: question, answer, result, attempt number.';

create function box_interval(p_box integer)
returns interval
language sql
immutable
as $$
  select make_interval(days => (array[0, 1, 3, 7, 14, 30, 60])[least(greatest(p_box, 0), 6) + 1])
$$;

-- Flashcard self-mark: "know" moves the word up a box, "practice" drops it to 0 (due now).
create function review_word(p_user_id text, p_word_id uuid, p_knew boolean)
returns void
language plpgsql
as $$
begin
  update words set
    box = case when p_knew then least(box + 1, 6) else 0 end,
    status = case when p_knew then 'known' else 'practice' end,
    due_at = now() + box_interval(case when p_knew then least(box + 1, 6) else 0 end),
    review_count = review_count + 1,
    last_reviewed_at = now()
  where id = p_word_id and user_id = p_user_id;

  if not found then
    raise exception 'word not found';
  end if;

  insert into reviews (user_id, word_id, knew) values (p_user_id, p_word_id, p_knew);
end;
$$;

-- Open (or re-open, on replay) a practice session. Returns its id.
create function start_practice(
  p_user_id text,
  p_request_id text,
  p_topic text,
  p_level text,
  p_mode text default 'text',
  p_source text default 'assistant'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into practice_sessions (user_id, request_id, topic, level, mode, source)
  values (p_user_id, p_request_id, p_topic, p_level, p_mode, p_source)
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from practice_sessions where user_id = p_user_id and request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

-- Store one checked answer. A replayed request_id returns the original row and
-- does not move the word's schedule a second time.
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
  p_checked_by text default 'assistant'
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
    limit 1;
    if v_word is null then
      raise exception 'unknown word: %. Add it with add_words first.', p_word;
    end if;
  end if;

  insert into exercises
    (user_id, request_id, session_id, word_id, question, answer, expected, result, attempt, checked_by)
  values (
    p_user_id, p_request_id, p_session_id, v_word, p_question, p_answer, p_expected, p_result,
    coalesce(p_attempt, 1 + (
      select count(*) from exercises e
      where e.user_id = p_user_id and e.question = p_question
        and e.session_id is not distinct from p_session_id)),
    p_checked_by
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

-- Save the outcome of a session: sentences, corrections, new words (also added to
-- the deck), rubric scores, feedback and its checked exercises. Safe to replay.
create function finish_practice(
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
      expected text, attempt integer, word text)
  loop
    perform record_exercise(
      p_user_id, x.request_id, x.question, x.answer, x.result, x.expected, x.attempt,
      p_session_id, x.word, p_checked_by);
  end loop;

  return p_session_id;
end;
$$;

-- Set how well a word is known (0 = new ... 6 = mastered); reschedules it.
create function set_word_familiarity(p_user_id text, p_word text, p_level integer)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  update words set
    box = p_level,
    due_at = now() + box_interval(p_level)
  where id = (
    select id from words
    where user_id = p_user_id and lower(english) = lower(trim(p_word))
    limit 1)
  returning id into v_id;

  if v_id is null then
    raise exception 'unknown word: %', p_word;
  end if;
  return v_id;
end;
$$;
