import { createRoot } from "react-dom/client";
import { DailyPractice } from "../../app/(main)/practice/DailyPractice";
import { ProfileForm } from "../../app/(main)/settings/ProfileForm";
import { DEFAULT_PROFILE } from "../../lib/learner-profile";

const parameters=new URLSearchParams(location.search);
const user=parameters.get("user")??"fixture-user";
const goal=parameters.get("goal")==="work" ? "work" as const : "everyday" as const;
const dialogue={id:`${goal}-workflow-dialogue`,title:"שיחה מותאמת",turns:[{they:"How are you?",theyHe:"מה שלומך?",options:["I'm fine.","Yesterday.","Two tables."],answer:0,answerHe:"אני בסדר."}]};
const calls: {name:string;args:unknown[]}[]=[];
const fixture={
  calls,failProfile:false,
  async mark(...args:unknown[]){calls.push({name:"mark",args});return {id:"1",wordId:args[0],knew:args[1]};},
  async answer(...args:unknown[]){calls.push({name:"answer",args});return {exercise_id:"exercise-one",selected_index:1,correct_index:1,result:"correct",answer:"I went yesterday.",expected:"I went yesterday.",explanation_he:"בעבר משתמשים ב־went."};},
  async review(...args:unknown[]){calls.push({name:"review",args});return {exercise_id:"exercise-two",review_id:"22222222-2222-4222-8222-222222222222",revision:0,stage:"completion",result:"correct",answer:"went",expected:"went",corrected_sentence:"I went yesterday.",explanation_he:"בעבר משתמשים ב־went.",selected_index:null,next_due_at:"2026-10-09T12:00:00Z",next_stage:"rewrite",source_session_id:null};},
  async conversation(requestId:string,dialogueId:string,picks:number[],expectedUserId:string){
    const canonicalPicks=[...picks];
    calls.push({name:"conversation",args:[requestId,dialogueId,canonicalPicks,expectedUserId]});
    if(dialogueId!==dialogue.id || expectedUserId!==user) throw new Error("Invalid fixture save scope");
    return {picks:canonicalPicks,correct:canonicalPicks.filter((pick,index)=>pick===dialogue.turns[index]?.answer).length,total:dialogue.turns.length};
  },
  async profile(...args:unknown[]){calls.push({name:"profile",args});if(fixture.failProfile){fixture.failProfile=false;throw new Error("save failed");}
    const input=args[0] as {goal:"work";daily_minutes:number;answers?:number[];level?:"A1"};
    return {...DEFAULT_PROFILE,goal:input.goal,daily_minutes:input.daily_minutes,level:input.answers ? "B1" : input.level,level_basis:input.answers ? "diagnostic":"self_selected",diagnostic_correct:input.answers ? 6:null,diagnostic_total:input.answers ? 6:null};},
};
Object.assign(window,{workflowMock:fixture});
const questions=Array.from({length:6},(_,i)=>({question:`Placement question ${i+1}`,choices:["First answer","Second answer","Third answer"]}));
createRoot(document.getElementById("root")!).render(<>
  <span className="sr-only">Workflow fixture</span>
  {parameters.get("mode")==="profile" ? <ProfileForm configured={false} profile={DEFAULT_PROFILE} questions={questions} /> :
    <DailyPractice learnerKey={user} day="2026-10-06" profile={{...DEFAULT_PROFILE,goal}}
      words={[{id:"word-one",english:"remember",hebrew:"לזכור",example:"I remember you.",box:1}]}
      questions={[{id:"question-one",question:"Which sentence describes yesterday?",choices:["I go yesterday.","I went yesterday.","I going yesterday."],original:"I go yesterday.",source_session_id:null}]}
      reviews={[{id:"22222222-2222-4222-8222-222222222222",source_question_id:"question-one",source_session_id:null,revision:0,stage:"completion",question:"Which sentence describes yesterday?",prompt:"I _____ yesterday.",choices:null,due_at:"2026-10-06T00:00:00Z",is_variant:false}]}
      dialogue={dialogue} doneToday={null} />}
</>);
