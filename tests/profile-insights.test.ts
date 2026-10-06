import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pool } from "../lib/db";
import { gradeDiagnostic } from "../lib/diagnostic";
import { profileInput, dailyBudget } from "../lib/learner-profile";
import { readLearnerProfile } from "../lib/profile-store";
import { getProgressInsights } from "../lib/progress-insights";
import { listDueWords } from "../lib/daily-store";

let db: PGlite;
before(async () => {
  db=new PGlite();
  for (const name of ["0001_auth.sql","0002_app.sql","0003_practice_questions.sql","0004_learning_loop.sql","0005_word_management.sql","0006_learner_profile.sql","0007_active_words.sql"]) {
    await db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),"utf8"));
  }
  await db.exec(`insert into "user"(id,name,email,"emailVerified") values
    ('profile-one','One','profile-one@example.invalid',true),('profile-two','Two','profile-two@example.invalid',true),
    ('insight-one','One','insight-one@example.invalid',true),('insight-two','Two','insight-two@example.invalid',true)`);
  mock.method(pool,"query",async (query:string,params:unknown[]=[])=>db.query(query,params));
});
after(async()=>{mock.restoreAll();await pool.end();await db?.close();});

test("placement is bounded, validates all answers and produces checked recognition evidence",()=>{
  assert.equal(gradeDiagnostic([0,1,2,0,1,2]).level,"B1");
  assert.equal(gradeDiagnostic([1,0,0,1,0,0]).level,"A0");
  assert.equal(gradeDiagnostic([0,1,0,1,0,0]).level,"A1");
  assert.throws(()=>gradeDiagnostic([0,1]));
  assert.throws(()=>gradeDiagnostic([0,1,2,0,1,3]));
  assert.equal(profileInput.safeParse({request_id:"profile-save",goal:"travel",daily_minutes:10,level:"B2",answers:[0,1,2,0,1,2]}).success,false);
  assert.equal(profileInput.safeParse({request_id:"profile-save",goal:"travel",daily_minutes:500,level:"B2"}).success,false);
  assert.deepEqual(dailyBudget(5),{words:4,questions:2,reviews:2});
  assert(dailyBudget(15).words>dailyBudget(5).words);
});

test("all migrations compose; profile retries keep evidence once and never overwrite later preferences",async()=>{
  const initial=await readLearnerProfile("profile-one");
  assert.equal(initial.configured,false);
  const diagnostic=gradeDiagnostic([0,1,2,0,1,2]);
  const save=async(request:string,goal:string,level:string,minutes:number,exercises:unknown=null)=>
    (await db.query<{profile:unknown}>("select save_learner_profile($1,$2,$3,$4,$5,$6::jsonb) as profile",
      ["profile-one",request,goal,level,minutes,exercises ? JSON.stringify(exercises) : null])).rows[0].profile;
  const first=await save("diagnostic-first","travel",diagnostic.level,5,diagnostic.exercises);
  await save("preferences-new","work","B2",15);
  assert.deepEqual(await save("diagnostic-first","everyday","A0",10),first);
  const current=await readLearnerProfile("profile-one");
  assert.equal(current.profile.goal,"work");assert.equal(current.profile.level,"B2");assert.equal(current.profile.level_basis,"self_selected");
  const rows=(await db.query<{count:number;formats:number}>("select count(*)::int as count,count(*) filter(where response_format='multiple_choice')::int as formats from exercises where user_id='profile-one'")).rows[0];
  assert.deepEqual(rows,{count:6,formats:6});
  assert.equal((await readLearnerProfile("profile-two")).configured,false);
  await assert.rejects(save("bad-preferences","work","D9",15));
  assert.equal((await readLearnerProfile("profile-one")).profile.level,"B2");
});

test("daily words exclude archived and other-user data; retention requires real delayed checked evidence",async()=>{
  const {rows:[word]}=await db.query<{id:string}>("insert into words(user_id,english,hebrew) values('insight-one','remember','לזכור') returning id");
  await db.exec("insert into words(user_id,english,hebrew,archived_at) values('insight-one','archived','מחוק',now()); insert into words(user_id,english,hebrew) values('insight-two','private','פרטי')");
  await db.query("select record_exercise('insight-one','retention-old','Translate remember','remember','correct',p_word=>'remember',p_response_format=>'free_response')");
  await db.exec("update exercises set created_at=now()-interval '8 days' where user_id='insight-one' and request_id='retention-old'");
  await db.query("select record_exercise('insight-one','retention-new','Translate remember','remember','correct',p_word=>'remember',p_response_format=>'free_response')");
  await db.query("update words set due_at=now()-interval '1 minute' where id=$1",[word.id]);
  assert.deepEqual((await listDueWords("insight-one",20)).map((item)=>item.english),["remember"]);
  const insights=await getProgressInsights("insight-one");
  assert.deepEqual(insights.retention,{tested:1,remembered:1});
  assert.deepEqual((await getProgressInsights("insight-two")).retention,{tested:0,remembered:0});
  assert.equal(insights.activity.attempts,1);
});

test("weekly mistake insights count first and later errors without including another learner",async()=>{
  const {rows:[question]}=await db.query<{id:string}>(`select queue_practice_question('insight-one','insight-question','Which is correct?',
    '["I go yesterday.","I went yesterday.","I going yesterday."]',1,'בעבר משתמשים ב־went.','I go yesterday.') as id`);
  await db.query("select answer_practice_question('insight-one',$1,0)",[question.id]);
  const {rows:[skill]}=await db.query<{id:string}>("select id from practice_skills where question_id=$1",[question.id]);
  await db.query("select answer_practice_review('insight-one',$1,$2,0,0,null)",[skill.id,crypto.randomUUID()]);
  const insights=await getProgressInsights("insight-one");
  assert.equal(insights.mistakes.length,1);assert.equal(insights.mistakes[0].errors,2);assert.equal(insights.mistakes[0].id,skill.id);
  assert.deepEqual((await getProgressInsights("insight-two")).mistakes,[]);
});

test("an immediate corrected retry is not counted as recall after a week",async()=>{
  await db.query("select record_exercise('insight-one','retention-immediate','Translate remember','remember','correct',p_word=>'remember',p_response_format=>'free_response')");
  assert.deepEqual((await getProgressInsights("insight-one")).retention,{tested:0,remembered:0});
});

test("archiving suspends scheduling from first answers, recurring reviews and assistant exercises",async()=>{
  const {rows:[word]}=await db.query<{id:string}>("insert into words(user_id,english,hebrew,box) values('insight-two','yesterday','אתמול',3) returning id");
  const {rows:[question]}=await db.query<{id:string}>(`select queue_practice_question('insight-two','archive-question','Which is correct?',
    '["I go yesterday.","I went yesterday.","I going yesterday."]',1,'בעבר משתמשים ב־went.','I go yesterday.',null,'yesterday') as id`);
  await db.query("select archive_word('insight-two',$1)",[word.id]);
  const state=async()=>(await db.query("select box,due_at,review_count from words where id=$1",[word.id])).rows[0];
  const original=await state();
  await db.query("select answer_practice_question('insight-two',$1,0)",[question.id]);
  assert.deepEqual(await state(),original);
  const {rows:[skill]}=await db.query<{id:string}>("select id from practice_skills where question_id=$1",[question.id]);
  await db.query("select answer_practice_review('insight-two',$1,$2,0,1,null)",[skill.id,crypto.randomUUID()]);
  await db.query("select record_exercise('insight-two','archived-assistant','Say yesterday','yesterday','correct',p_word=>'yesterday',p_response_format=>'free_response')");
  assert.deepEqual(await state(),original);
  await assert.rejects(db.query("select set_word_familiarity('insight-two','yesterday',6)"));
  assert.deepEqual((await getProgressInsights("insight-two")).mistakes,[]);
  const {rows:[session]}=await db.query<{id:string}>("select start_practice('insight-two','restore-through-session','Yesterday','A1') as id");
  await db.query("select finish_practice('insight-two',$1,p_new_words=>'[{\"english\":\"yesterday\",\"hebrew\":\"אתמול\"}]'::jsonb)",[session.id]);
  assert.equal((await db.query<{archived_at:string|null}>("select archived_at from words where id=$1",[word.id])).rows[0].archived_at,null);
});
