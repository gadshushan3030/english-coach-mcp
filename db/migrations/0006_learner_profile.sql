create table learner_profiles (
  user_id text primary key references "user" (id) on delete cascade,
  goal text not null check (goal in ('everyday','work','travel')),
  level text not null check (level in ('A0','A1','A2','B1','B2','C1','C2')),
  daily_minutes smallint not null check (daily_minutes in (5,10,15)),
  level_basis text not null check (level_basis in ('diagnostic','self_selected')),
  diagnostic_correct smallint,
  diagnostic_total smallint,
  updated_at timestamptz not null default now(),
  check ((level_basis = 'self_selected' and diagnostic_correct is null and diagnostic_total is null)
    or (level_basis = 'diagnostic' and diagnostic_total is not null and diagnostic_correct is not null
      and diagnostic_total = 6 and diagnostic_correct between 0 and 6))
);

create table learner_profile_saves (
  user_id text not null references "user" (id) on delete cascade,
  request_id text not null check (char_length(request_id) between 8 and 88),
  profile jsonb not null,
  primary key (user_id, request_id)
);

create function save_learner_profile(p_user_id text, p_request_id text, p_goal text,
  p_level text, p_minutes integer, p_diagnostic jsonb default null)
returns jsonb language plpgsql as $$
declare
  v_profile jsonb;
  v_basis text := case when p_diagnostic is null then 'self_selected' else 'diagnostic' end;
  v_correct integer;
  v_item jsonb;
  v_index integer := 0;
begin
  -- Serialize updates per user; an old retry must never overwrite a newer setting.
  perform 1 from "user" where id = p_user_id for update;
  if not found then raise exception 'user not found'; end if;
  select profile into v_profile from learner_profile_saves where user_id=p_user_id and request_id=p_request_id;
  if found then return v_profile; end if;
  if p_diagnostic is not null then
    if jsonb_typeof(p_diagnostic) <> 'array' or jsonb_array_length(p_diagnostic) <> 6 then
      raise exception 'invalid diagnostic';
    end if;
    select count(*) into v_correct from jsonb_array_elements(p_diagnostic) value where value->>'result' = 'correct';
  end if;
  insert into learner_profiles(user_id,goal,level,daily_minutes,level_basis,diagnostic_correct,diagnostic_total)
    values(p_user_id,p_goal,p_level,p_minutes,v_basis,v_correct,case when p_diagnostic is null then null else 6 end)
    on conflict(user_id) do update set goal=excluded.goal,level=excluded.level,daily_minutes=excluded.daily_minutes,
      level_basis=excluded.level_basis,diagnostic_correct=excluded.diagnostic_correct,diagnostic_total=excluded.diagnostic_total,updated_at=now();
  if p_diagnostic is not null then
    for v_item in select value from jsonb_array_elements(p_diagnostic) loop
      perform record_exercise(p_user_id, 'placement:' || p_request_id || ':' || v_index,
        v_item->>'question',v_item->>'answer',v_item->>'result',v_item->>'expected',
        p_checked_by=>'app',p_response_format=>'multiple_choice');
      v_index := v_index + 1;
    end loop;
  end if;
  select to_jsonb(p) - 'user_id' - 'updated_at' into v_profile from learner_profiles p where user_id=p_user_id;
  insert into learner_profile_saves values(p_user_id,p_request_id,v_profile);
  return v_profile;
end;
$$;
