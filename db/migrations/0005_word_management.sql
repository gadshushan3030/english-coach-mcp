-- Keep learning evidence when a word is removed from the active vocabulary.
alter table words add column archived_at timestamptz;
create index words_active_due_idx on words (user_id, due_at) where archived_at is null;

-- Old marks remain valid historical self-assessments without a request id.
alter table reviews add column request_id text
  check (request_id is null or request_id ~ '^[A-Za-z0-9:_-]{8,100}$');
alter table reviews add constraint reviews_user_request_unique unique (user_id, request_id);
alter table reviews add foreign key (word_id, user_id) references words (id, user_id) on delete cascade;

create function archive_word(p_user_id text, p_word_id uuid)
returns uuid
language plpgsql
as $$
begin
  update words set archived_at = coalesce(archived_at, clock_timestamp())
  where id = p_word_id and user_id = p_user_id;
  if not found then raise exception 'word not found'; end if;
  return p_word_id;
end;
$$;

create function restore_word(p_user_id text, p_word_id uuid)
returns uuid
language plpgsql
as $$
begin
  update words set archived_at = null where id = p_word_id and user_id = p_user_id;
  if not found then raise exception 'word not found'; end if;
  return p_word_id;
end;
$$;

-- First mark for a request is authoritative. Retries never schedule twice or
-- create checked-answer evidence; these are still self-assessments only.
create function review_word_once(
  p_user_id text, p_word_id uuid, p_knew boolean, p_request_id text
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
  v_word uuid;
begin
  if p_word_id is null or p_knew is null or p_request_id is null
     or p_request_id !~ '^[A-Za-z0-9:_-]{8,100}$' then
    raise exception 'invalid self-assessment request';
  end if;

  select id, word_id into v_id, v_word from reviews
  where user_id = p_user_id and request_id = p_request_id;
  if v_id is not null then
    if v_word <> p_word_id then raise exception 'review request already used'; end if;
    return v_id;
  end if;

  perform 1 from words
  where id = p_word_id and user_id = p_user_id and archived_at is null
  for update;
  if not found then raise exception 'active word not found'; end if;

  insert into reviews (user_id, word_id, knew, request_id)
  values (p_user_id, p_word_id, p_knew, p_request_id)
  on conflict (user_id, request_id) do nothing returning id into v_id;
  if v_id is null then
    select id, word_id into v_id, v_word from reviews
    where user_id = p_user_id and request_id = p_request_id;
    if v_word <> p_word_id then raise exception 'review request already used'; end if;
    return v_id;
  end if;

  update words set
    box = case when p_knew then least(box + 1, 6) else 0 end,
    status = case when p_knew then 'known' else 'practice' end,
    due_at = now() + box_interval(case when p_knew then least(box + 1, 6) else 0 end),
    review_count = review_count + 1,
    last_reviewed_at = now()
  where id = p_word_id and user_id = p_user_id;
  return v_id;
end;
$$;
