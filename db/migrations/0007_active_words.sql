-- Archiving preserves evidence but suspends every source of word scheduling.
-- Reuse the canonical functions from prior migrations without duplicating their
-- grading/retry logic. Assert the expected body before applying each small edit.
do $$
declare
  v_definition text;
  v_updated text;
  v_item record;
begin
  for v_item in select * from (values
    ('record_exercise(text,text,text,text,text,text,integer,uuid,text,text,text)',
      'where id = v_word;', 'where id = v_word and archived_at is null;'),
    ('answer_practice_review(text,uuid,text,integer,integer,text)',
      'where id = c.word_id and user_id = p_user_id;',
      'where id = c.word_id and user_id = p_user_id and archived_at is null;'),
    ('review_word(text,uuid,boolean)',
      'where id = p_word_id and user_id = p_user_id;',
      'where id = p_word_id and user_id = p_user_id and archived_at is null;'),
    ('finish_practice(text,uuid,jsonb,jsonb,jsonb,smallint,smallint,smallint,smallint,text,jsonb,text)',
      'on conflict (user_id, english) do nothing;',
      'on conflict (user_id, english) do update set archived_at=null where words.archived_at is not null;')
  ) as edits(signature,old_text,new_text) loop
    select pg_get_functiondef(v_item.signature::regprocedure) into v_definition;
    v_updated := replace(v_definition,v_item.old_text,v_item.new_text);
    if v_updated=v_definition then raise exception 'active-word migration requires expected function body: %',v_item.signature; end if;
    execute v_updated;
  end loop;
end;
$$;

create or replace function set_word_familiarity(p_user_id text,p_word text,p_level integer)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_level is null or p_level not between 0 and 6 then raise exception 'invalid familiarity'; end if;
  update words set box=p_level,due_at=now()+box_interval(p_level)
  where archived_at is null and user_id=p_user_id and id=(
    select id from words where user_id=p_user_id and archived_at is null
      and lower(english)=lower(trim(p_word)) order by (english=trim(p_word)) desc,id limit 1)
  returning id into v_id;
  if v_id is null then raise exception 'active word not found'; end if;
  return v_id;
end;
$$;
