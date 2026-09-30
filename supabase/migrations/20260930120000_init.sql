-- Learning data for a single-owner English app.
-- Every table is owned per user and locked down with RLS; anon gets nothing.

create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  english text not null check (char_length(english) between 1 and 100),
  hebrew text not null check (char_length(hebrew) between 1 and 100),
  example text check (char_length(example) <= 300),
  status text not null default 'new' check (status in ('new', 'practice', 'known')),
  box smallint not null default 0 check (box between 0 and 6),
  due_at timestamptz not null default now(),
  review_count integer not null default 0,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, english)
);
create index words_user_due_idx on public.words (user_id, due_at);

create table public.reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  word_id uuid not null references public.words on delete cascade,
  knew boolean not null,
  reviewed_at timestamptz not null default now()
);
create index reviews_user_time_idx on public.reviews (user_id, reviewed_at);

create table public.conversation_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  dialogue_id text not null,
  score smallint not null check (score >= 0),
  total smallint not null check (total > 0 and score <= total),
  completed_at timestamptz not null default now(),
  unique (user_id, day, dialogue_id)
);

alter table public.words enable row level security;
alter table public.reviews enable row level security;
alter table public.conversation_sessions enable row level security;

create policy "own words" on public.words
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- A review may only point at one of the caller's own words.
create policy "own reviews" on public.reviews
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.words w where w.id = word_id and w.user_id = (select auth.uid()))
  );

create policy "own conversation sessions" on public.conversation_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.words, public.reviews, public.conversation_sessions from anon;
grant select, insert, update, delete on public.words, public.reviews, public.conversation_sessions to authenticated;

-- Leitner-style scheduling: "know" moves the word up a box (1, 3, 7, 14, 30, 60 days),
-- "practice" drops it to box 0 and makes it due again right away.
-- Runs as the caller, so RLS still applies.
create function public.review_word(p_word_id uuid, p_knew boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.words set
    box = case when p_knew then least(box + 1, 6) else 0 end,
    status = case when p_knew then 'known' else 'practice' end,
    due_at = now() + case
      when p_knew then make_interval(days => (array[1, 3, 7, 14, 30, 60])[least(box + 1, 6)])
      else interval '0'
    end,
    review_count = review_count + 1,
    last_reviewed_at = now()
  where id = p_word_id;

  if not found then
    raise exception 'word not found';
  end if;

  insert into public.reviews (word_id, knew) values (p_word_id, p_knew);
end;
$$;

revoke execute on function public.review_word(uuid, boolean) from public, anon;
grant execute on function public.review_word(uuid, boolean) to authenticated;
