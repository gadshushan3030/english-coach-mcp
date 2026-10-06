-- Later reviews are separate evidence. The first practice_question answer stays fixed.
-- A generated gap may be a few characters longer than its 500-character sentence.
alter table exercises drop constraint exercises_question_check;
alter table exercises add constraint exercises_question_check check (char_length(question) between 1 and 1000);
alter table exercises drop constraint exercises_response_format_check;
alter table exercises add constraint exercises_response_format_check
  check (response_format in ('unspecified', 'multiple_choice', 'gap_completion', 'free_response'));

create table practice_question_variants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  question_id uuid not null,
  position smallint not null check (position between 1 and 10),
  question text not null check (char_length(question) between 1 and 500 and question = trim_practice_text(question)),
  choices jsonb not null check (valid_practice_choices(choices)),
  correct_index smallint not null check (correct_index between 0 and 2),
  explanation_he text not null check (char_length(explanation_he) between 1 and 500 and explanation_he = trim_practice_text(explanation_he) and explanation_he ~ '[א-ת]'),
  original text not null check (char_length(original) between 1 and 500 and original = trim_practice_text(original)),
  unique (question_id, position),
  foreign key (question_id, user_id) references practice_questions (id, user_id) on delete cascade
);
create function guard_review_variant() returns trigger language plpgsql as $$
begin
  raise exception 'review variant content is immutable';
end;
$$;
create trigger review_variant_guard before update on practice_question_variants
for each row execute function guard_review_variant();

create function queue_review_variants(p_user_id text, p_question_id uuid, p_variants jsonb)
returns void language plpgsql as $$
declare x jsonb; v_position integer := 0;
begin
  perform 1 from practice_questions where id = p_question_id and user_id = p_user_id for update;
  if not found then raise exception 'practice question not found'; end if;
  -- The first complete variant set wins, including after an uncertain response.
  if exists (select 1 from practice_question_variants where question_id = p_question_id and user_id = p_user_id) then return; end if;
  if p_variants is null or jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) > 10 then
    raise exception 'review variants must be an array of at most 10';
  end if;
  for x in select value from jsonb_array_elements(p_variants) loop
    v_position := v_position + 1;
    insert into practice_question_variants (user_id, question_id, position, question, choices, correct_index, explanation_he, original)
    values (p_user_id, p_question_id, v_position, x->>'question', x->'choices', (x->>'correct_index')::smallint, x->>'explanation_he', x->>'original');
  end loop;
end;
$$;

create table practice_skills (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  question_id uuid not null unique,
  stage text not null check (stage in ('recognition', 'completion', 'rewrite')),
  revision integer not null default 0 check (revision >= 0),
  variant_position smallint not null default 0 check (variant_position between 0 and 10),
  streak integer not null default 0 check (streak >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  last_result text check (last_result in ('correct', 'incorrect')),
  due_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, user_id),
  foreign key (question_id, user_id) references practice_questions (id, user_id) on delete cascade
);
create index practice_skills_user_due_idx on practice_skills (user_id, due_at, id);
comment on table practice_skills is 'Scheduled recognition, constrained gap completion, and exact-wording rewrite practice.';

create table practice_skill_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references "user" (id) on delete cascade,
  request_id text not null check (request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  review_id uuid not null,
  exercise_id uuid not null unique,
  revision integer not null check (revision >= 0),
  stage text not null check (stage in ('recognition', 'completion', 'rewrite')),
  variant_position smallint not null check (variant_position between 0 and 10),
  selected_index smallint check (selected_index between 0 and 2),
  corrected_sentence text not null,
  explanation_he text not null,
  next_due_at timestamptz not null,
  next_stage text not null check (next_stage in ('recognition', 'completion', 'rewrite')),
  unique (user_id, request_id),
  unique (review_id, revision),
  foreign key (review_id, user_id) references practice_skills (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references exercises (id, user_id),
  check ((stage = 'recognition' and selected_index is not null) or (stage <> 'recognition' and selected_index is null))
);
create index practice_skill_attempts_user_idx on practice_skill_attempts (user_id, review_id);

create function normalize_review_answer(p_text text) returns text language sql immutable strict as $$
  select trim_practice_text(regexp_replace(regexp_replace(lower(replace(replace(trim_practice_text(p_text), '’', ''''), '‘', '''')), '[[:space:]]+', ' ', 'g'), '[.!?]+$', ''))
$$;
create function review_completion(p_expected text, p_original text)
returns table (prompt text, expected text) language plpgsql immutable strict as $$
declare v_tokens text[]; v_original text[]; v_at integer; i integer;
begin
  v_tokens := regexp_split_to_array(trim_practice_text(p_expected), '[[:space:]]+');
  v_original := regexp_split_to_array(trim_practice_text(p_original), '[[:space:]]+');
  for i in 1..array_length(v_tokens, 1) loop
    if normalize_review_answer(v_tokens[i]) <> normalize_review_answer(coalesce(v_original[i], '')) then v_at := i; exit; end if;
  end loop;
  v_at := coalesce(v_at, floor(array_length(v_tokens, 1) / 2.0)::integer + 1);
  expected := v_tokens[v_at];
  v_tokens[v_at] := '_____';
  prompt := array_to_string(v_tokens, ' ');
  return next;
end;
$$;

create view practice_review_content as
select s.id, s.user_id, s.question_id, s.stage, s.revision, s.variant_position, s.streak,
       s.review_count, s.due_at, q.source_session_id, q.word_id,
       coalesce(v.question, q.question) as question, coalesce(v.choices, q.choices) as choices,
       coalesce(v.correct_index, q.correct_index) as correct_index,
       coalesce(v.explanation_he, q.explanation_he) as explanation_he,
       coalesce(v.original, q.original) as original,
       coalesce(v.choices ->> v.correct_index, q.choices ->> q.correct_index) as corrected_sentence
from practice_skills s join practice_questions q on q.id = s.question_id and q.user_id = s.user_id
left join practice_question_variants v on v.question_id = q.id and v.user_id = q.user_id and v.position = s.variant_position;

create function sync_practice_reviews(p_user_id text) returns void language sql as $$
  insert into practice_skills (user_id, question_id, stage, due_at)
  select q.user_id, q.id, case when q.selected_index = q.correct_index then 'completion' else 'recognition' end,
         q.answered_at + case when q.selected_index = q.correct_index then interval '1 day' else interval '10 minutes' end
  from practice_questions q where q.user_id = p_user_id and q.answered_at is not null
  on conflict (question_id) do nothing
$$;
create function seed_practice_review() returns trigger language plpgsql as $$
begin
  if new.answered_at is not null then perform sync_practice_reviews(new.user_id); end if;
  return new;
end;
$$;
create trigger seed_practice_review_after_answer after insert or update on practice_questions
for each row execute function seed_practice_review();
insert into practice_skills (user_id, question_id, stage, due_at)
select user_id, id, case when selected_index = correct_index then 'completion' else 'recognition' end,
       answered_at + case when selected_index = correct_index then interval '1 day' else interval '10 minutes' end
from practice_questions where answered_at is not null;

create function answer_practice_review(p_user_id text, p_review_id uuid, p_request_id text,
  p_revision integer, p_selected_index integer default null, p_answer text default null)
returns uuid language plpgsql as $$
declare s practice_skills%rowtype; c record; a practice_skill_attempts%rowtype;
  v_exercise uuid; v_answer text; v_expected text; v_prompt text; v_correct boolean;
  v_stage text; v_streak integer; v_due timestamptz; v_format text; v_variants integer;
begin
  select * into s from practice_skills where id = p_review_id and user_id = p_user_id for update;
  if not found then raise exception 'practice review not found'; end if;
  select * into a from practice_skill_attempts where user_id = p_user_id and request_id = p_request_id;
  if found then
    if a.review_id <> p_review_id then raise exception 'review request id already used'; end if;
    return a.exercise_id;
  end if;
  if p_revision is null or s.revision <> p_revision then raise exception 'practice review changed; reload'; end if;
  if p_request_id is null or p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid review request id';
  end if;
  select * into c from practice_review_content where id = s.id and user_id = p_user_id;
  if s.stage = 'recognition' then
    if p_selected_index is null or p_selected_index not between 0 and 2 or p_answer is not null then raise exception 'selected_index required'; end if;
    v_answer := c.choices ->> p_selected_index;
    v_expected := c.corrected_sentence;
    v_prompt := c.question;
    v_correct := p_selected_index = c.correct_index;
    v_format := 'multiple_choice';
  else
    if p_selected_index is not null or p_answer is null or char_length(trim_practice_text(p_answer)) not between 1 and 1000 then raise exception 'typed answer required'; end if;
    v_answer := trim_practice_text(p_answer);
    if s.stage = 'completion' then
      select prompt, expected into v_prompt, v_expected from review_completion(c.corrected_sentence, c.original);
      v_format := 'gap_completion';
    else
      v_prompt := c.original;
      v_expected := c.corrected_sentence;
      v_format := 'free_response';
    end if;
    v_correct := normalize_review_answer(v_answer) = normalize_review_answer(v_expected);
  end if;
  select count(*) into v_variants from practice_question_variants where question_id = s.question_id and user_id = p_user_id;
  v_stage := case when not v_correct and s.stage = 'rewrite' then 'completion'
                  when not v_correct then s.stage when s.stage = 'recognition' then 'completion'
                  when s.stage = 'rewrite' and v_variants > 0 then 'recognition' else 'rewrite' end;
  v_streak := case when v_correct then s.streak + 1 else 0 end;
  v_due := clock_timestamp() + case when not v_correct then interval '10 minutes'
    when s.stage = 'recognition' then interval '1 day' when s.stage = 'completion' then interval '3 days'
    else make_interval(days => least(30, 7 * power(2, least(s.streak, 3))::integer)) end;
  -- Reserved exercise IDs cannot adopt unrelated assistant-created evidence.
  if exists (select 1 from exercises where user_id = p_user_id and request_id = 'review:' || p_request_id) then
    raise exception 'review request id already used';
  end if;
  insert into exercises (user_id, request_id, word_id, question, answer, expected, result, attempt, checked_by, response_format)
  values (p_user_id, 'review:' || p_request_id, c.word_id, v_prompt, v_answer, v_expected,
          case when v_correct then 'correct' else 'incorrect' end, least(s.review_count + 1, 32767), 'app', v_format)
  returning id into v_exercise;
  insert into practice_skill_attempts (user_id, request_id, review_id, exercise_id, revision, stage,
    variant_position, selected_index, corrected_sentence, explanation_he, next_due_at, next_stage)
  values (p_user_id, p_request_id, s.id, v_exercise, s.revision, s.stage, s.variant_position,
    p_selected_index, c.corrected_sentence, c.explanation_he, v_due, v_stage);
  update practice_skills set stage = v_stage, streak = v_streak, due_at = v_due,
    revision = revision + 1, review_count = review_count + 1,
    last_result = case when v_correct then 'correct' else 'incorrect' end,
    variant_position = case when v_correct and s.stage = 'rewrite' then (s.variant_position + 1) % (v_variants + 1) else s.variant_position end
  where id = s.id and user_id = p_user_id;
  -- Move only the linked deck word, using its fixed identity rather than spelling.
  if c.word_id is not null then
    update words set box = case when v_correct then least(box + 1, 6) else 0 end,
      due_at = clock_timestamp() + box_interval(case when v_correct then least(box + 1, 6) else 0 end)
    where id = c.word_id and user_id = p_user_id;
  end if;
  return v_exercise;
end;
$$;

-- Later exercises are immutable once linked. Clearing a deleted word remains valid.
create function guard_practice_review_exercise() returns trigger language plpgsql as $$
begin
  if exists (select 1 from practice_skill_attempts where exercise_id = old.id) and (
    row(new.id, new.user_id, new.request_id, new.session_id, new.question, new.answer, new.expected,
        new.result, new.attempt, new.checked_by, new.response_format, new.question_id, new.selected_index, new.created_at)
    is distinct from row(old.id, old.user_id, old.request_id, old.session_id, old.question, old.answer, old.expected,
        old.result, old.attempt, old.checked_by, old.response_format, old.question_id, old.selected_index, old.created_at)
    or (new.word_id is distinct from old.word_id and new.word_id is not null)) then
    raise exception 'practice review exercise is immutable';
  end if;
  return new;
end;
$$;
create trigger practice_review_exercise_guard before update on exercises
for each row execute function guard_practice_review_exercise();

-- Direct SQL cannot attach an invented grade or another user's evidence to a review.
create function guard_practice_review_attempt() returns trigger language plpgsql as $$
declare c record; e exercises%rowtype; v_expected text; v_prompt text; v_correct boolean; v_format text; v_next text; v_variants integer;
begin
  if tg_op = 'UPDATE' then raise exception 'practice review attempt is immutable'; end if;
  select * into c from practice_review_content where id = new.review_id and user_id = new.user_id;
  if not found then raise exception 'practice review not found'; end if;
  select * into e from exercises where id = new.exercise_id and user_id = new.user_id;
  if not found then raise exception 'review exercise not found'; end if;
  if new.stage = 'recognition' then
    v_expected := c.corrected_sentence; v_prompt := c.question; v_format := 'multiple_choice';
    v_correct := new.selected_index = c.correct_index;
    if e.answer is distinct from (c.choices ->> new.selected_index) then raise exception 'review answer must match saved choice'; end if;
  else
    if new.stage = 'completion' then
      select prompt, expected into v_prompt, v_expected from review_completion(c.corrected_sentence, c.original);
      v_format := 'gap_completion';
    else v_prompt := c.original; v_expected := c.corrected_sentence; v_format := 'free_response'; end if;
    v_correct := normalize_review_answer(e.answer) = normalize_review_answer(v_expected);
  end if;
  select count(*) into v_variants from practice_question_variants where question_id = c.question_id and user_id = new.user_id;
  v_next := case when not v_correct and c.stage = 'rewrite' then 'completion'
                when not v_correct then c.stage when c.stage = 'recognition' then 'completion'
                when c.stage = 'rewrite' and v_variants > 0 then 'recognition' else 'rewrite' end;
  if new.revision <> c.revision or new.stage <> c.stage or new.variant_position <> c.variant_position
     or new.corrected_sentence <> c.corrected_sentence or new.explanation_he <> c.explanation_he
     or new.next_stage <> v_next or e.request_id <> 'review:' || new.request_id
     or e.question <> v_prompt or e.expected is distinct from v_expected
     or e.result <> (case when v_correct then 'correct' else 'incorrect' end)
     or e.response_format <> v_format or e.checked_by <> 'app' or e.session_id is not null
     or e.question_id is not null or e.selected_index is not null or e.word_id is distinct from c.word_id
     or e.attempt <> least(c.review_count + 1, 32767) then
    raise exception 'review exercise must match saved canonical content';
  end if;
  return new;
end;
$$;
create trigger practice_review_attempt_guard before insert or update on practice_skill_attempts
for each row execute function guard_practice_review_attempt();
