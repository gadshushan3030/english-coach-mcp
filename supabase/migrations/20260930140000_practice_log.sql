-- Practice log shared by the in-app drills and the external assistant (MCP).
--
-- Two kinds of evidence are kept apart on purpose:
--   reviews   = self-assessment from the flashcards ("I know" / "need practice")
--   exercises = answers that were actually checked (by the app or by the assistant)
--
-- Every write takes a caller-chosen request_id; replaying the same request returns
-- the existing row instead of creating a duplicate.

drop table public.conversation_sessions;

comment on table public.reviews is 'Self-assessment marks from the flashcards. Not a checked answer.';

-- Familiarity level (0-6) doubles as the spaced-repetition box.
create function public.box_interval(p_box integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select make_interval(days => (array[0, 1, 3, 7, 14, 30, 60])[least(greatest(p_box, 0), 6) + 1])
$$;

create or replace function public.review_word(p_word_id uuid, p_knew boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.words set
    box = case when p_knew then least(box + 1, 6) else 0 end,
    status = case when p_knew then 'known' else 'practice' end,
    due_at = now() + public.box_interval(case when p_knew then least(box + 1, 6) else 0 end),
    review_count = review_count + 1,
    last_reviewed_at = now()
  where id = p_word_id;

  if not found then
    raise exception 'word not found';
  end if;

  insert into public.reviews (word_id, knew) values (p_word_id, p_knew);
end;
$$;

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
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
create index practice_sessions_user_day_idx on public.practice_sessions (user_id, day desc);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 100),
  session_id uuid references public.practice_sessions on delete cascade,
  word_id uuid references public.words on delete set null,
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) <= 1000),
  expected text check (char_length(expected) <= 500),
  result text not null check (result in ('correct', 'partial', 'incorrect')),
  attempt smallint not null default 1 check (attempt >= 1),
  checked_by text not null check (checked_by in ('assistant', 'app')),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);
create index exercises_user_time_idx on public.exercises (user_id, created_at desc);
create index exercises_session_idx on public.exercises (session_id);
create index exercises_word_idx on public.exercises (word_id);

comment on table public.exercises is 'Checked answers only: question, answer, result, attempt number.';

alter table public.practice_sessions enable row level security;
alter table public.exercises enable row level security;

create policy "own practice sessions" on public.practice_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Foreign keys bypass RLS, so make sure linked rows are the caller's own too.
create policy "own exercises" on public.exercises
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (session_id is null or exists (
      select 1 from public.practice_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
    and (word_id is null or exists (
      select 1 from public.words w where w.id = word_id and w.user_id = (select auth.uid())))
  );

revoke all on public.practice_sessions, public.exercises from anon;
grant select, insert, update, delete on public.practice_sessions, public.exercises to authenticated;

-- Open (or re-open, on replay) a practice session. Returns its id.
create function public.start_practice(
  p_request_id text,
  p_topic text,
  p_level text,
  p_mode text default 'text',
  p_source text default 'assistant'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.practice_sessions (request_id, topic, level, mode, source)
  values (p_request_id, p_topic, p_level, p_mode, p_source)
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.practice_sessions
    where user_id = auth.uid() and request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

-- Store one checked answer. A replayed request_id returns the original row and
-- does not move the word's schedule a second time.
create function public.record_exercise(
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
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_word uuid;
begin
  select id into v_id from public.exercises where user_id = auth.uid() and request_id = p_request_id;
  if v_id is not null then
    return v_id;
  end if;

  if p_word is not null then
    select id into v_word from public.words
    where user_id = auth.uid() and lower(english) = lower(trim(p_word))
    limit 1;
    if v_word is null then
      raise exception 'unknown word: %. Add it with add_words first.', p_word;
    end if;
  end if;

  insert into public.exercises
    (request_id, session_id, word_id, question, answer, expected, result, attempt, checked_by)
  values (
    p_request_id, p_session_id, v_word, p_question, p_answer, p_expected, p_result,
    coalesce(p_attempt, 1 + (
      select count(*) from public.exercises e
      where e.user_id = auth.uid() and e.question = p_question
        and e.session_id is not distinct from p_session_id)),
    p_checked_by
  )
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.exercises where user_id = auth.uid() and request_id = p_request_id;
    return v_id;
  end if;

  if v_word is not null then
    update public.words set
      box = case p_result when 'correct' then least(box + 1, 6) when 'incorrect' then 0 else box end,
      due_at = now() + public.box_interval(
        case p_result when 'correct' then least(box + 1, 6) when 'incorrect' then 0 else greatest(box, 1) end)
    where id = v_word;
  end if;

  return v_id;
end;
$$;

-- Save the outcome of a session: sentences, corrections, new words (also added to
-- the deck), rubric scores, feedback and its checked exercises. Safe to replay.
create function public.finish_practice(
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
security invoker
set search_path = ''
as $$
declare
  x record;
begin
  update public.practice_sessions set
    sentences = p_sentences,
    corrections = p_corrections,
    new_words = p_new_words,
    comprehension = p_comprehension,
    vocabulary = p_vocabulary,
    grammar = p_grammar,
    pronunciation = p_pronunciation,
    feedback = p_feedback,
    completed_at = coalesce(completed_at, now())
  where id = p_session_id;

  if not found then
    raise exception 'practice session not found';
  end if;

  insert into public.words (english, hebrew, example)
  select trim(w.english), trim(w.hebrew), nullif(trim(w.example), '')
  from jsonb_to_recordset(p_new_words) as w(english text, hebrew text, example text)
  on conflict (user_id, english) do nothing;

  for x in
    select * from jsonb_to_recordset(p_exercises) as e(
      request_id text, question text, answer text, result text,
      expected text, attempt integer, word text)
  loop
    perform public.record_exercise(
      x.request_id, x.question, x.answer, x.result, x.expected, x.attempt,
      p_session_id, x.word, p_checked_by);
  end loop;

  return p_session_id;
end;
$$;

-- Set how well a word is known (0 = new ... 6 = mastered); reschedules it.
create function public.set_word_familiarity(p_word text, p_level integer)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.words set
    box = p_level,
    due_at = now() + public.box_interval(p_level)
  where id = (
    select id from public.words
    where user_id = auth.uid() and lower(english) = lower(trim(p_word))
    limit 1)
  returning id into v_id;

  if v_id is null then
    raise exception 'unknown word: %', p_word;
  end if;
  return v_id;
end;
$$;

revoke execute on function
  public.box_interval(integer),
  public.start_practice(text, text, text, text, text),
  public.record_exercise(text, text, text, text, text, integer, uuid, text, text),
  public.finish_practice(uuid, jsonb, jsonb, jsonb, smallint, smallint, smallint, smallint, text, jsonb, text),
  public.set_word_familiarity(text, integer)
from public, anon;

grant execute on function
  public.box_interval(integer),
  public.start_practice(text, text, text, text, text),
  public.record_exercise(text, text, text, text, text, integer, uuid, text, text),
  public.finish_practice(uuid, jsonb, jsonb, jsonb, smallint, smallint, smallint, smallint, text, jsonb, text),
  public.set_word_familiarity(text, integer)
to authenticated;

-- Access tokens are JWTs and stay valid until they expire. /mcp calls this on every
-- request so that revoking a connection (which deletes its session) cuts access at once.
create function public.session_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions
    where id = nullif(auth.jwt() ->> 'session_id', '')::uuid and user_id = auth.uid())
$$;

revoke execute on function public.session_is_active() from public, anon;
grant execute on function public.session_is_active() to authenticated;
