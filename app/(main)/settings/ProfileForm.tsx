"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { saveLearnerProfile } from "@/app/profile-actions";
import { GOALS, LEVELS, type LearnerProfile, type LearningGoal, type LearningLevel } from "@/lib/learner-profile";

type PlacementQuestion = { question: string; choices: readonly string[] };

export function ProfileForm({ profile, configured, questions }: {
  profile: LearnerProfile; configured: boolean; questions: PlacementQuestion[];
}) {
  const [goal, setGoal] = useState<LearningGoal>(profile.goal);
  const [minutes, setMinutes] = useState(profile.daily_minutes);
  const [level, setLevel] = useState<LearningLevel>(profile.level);
  const [assessment, setAssessment] = useState(!configured);
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null));
  const [saved, setSaved] = useState<LearnerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const flight = useRef(false);
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);

  function submit() {
    if (flight.current) return;
    if (assessment && answers.some((answer) => answer === null)) {
      setError("יש לענות על כל שש השאלות"); return;
    }
    const value = { goal, daily_minutes: minutes, ...(assessment ? { answers } : { level }) };
    const signature = JSON.stringify(value);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    const input = { ...value, request_id: attempt.current.requestId };
    flight.current = true;
    setError(null);
    startTransition(async () => {
      try { setSaved(await saveLearnerProfile(input)); attempt.current = null; }
      catch { setError("השמירה לא אושרה. אפשר לנסות שוב; הבחירות נשארו בטופס."); }
      finally { flight.current = false; }
    });
  }

  if (saved) return (
    <section className="surface flex flex-col gap-4 p-5" role="status">
      <h2 className="text-xl font-bold">התרגול הותאם לך</h2>
      <p>{GOALS[saved.goal]} · {saved.daily_minutes} דקות ביום · רמת פתיחה {saved.level}</p>
      {saved.level_basis === "diagnostic" && <p className="muted text-sm">{saved.diagnostic_correct}/{saved.diagnostic_total} באבחון. זו הערכת פתיחה קצרה; אפשר לעדכן את הרמה לפי החוויה בתרגול.</p>}
      <Link href="/practice" className="btn">לתרגול שלי להיום</Link>
      <button type="button" className="btn btn-ghost" onClick={() => { setLevel(saved.level); setAssessment(false); setSaved(null); }}>עריכת ההעדפות</button>
    </section>
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <fieldset disabled={pending} className="surface flex min-w-0 flex-col gap-4 p-5">
        <legend className="sr-only">העדפות הלמידה</legend>
        <label className="flex flex-col gap-2"><span className="font-semibold">בשביל מה ללמוד אנגלית?</span>
          <select className="input" value={goal} onChange={(event) => setGoal(event.target.value as LearningGoal)}>
            {Object.entries(GOALS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-2"><span className="font-semibold">כמה זמן מתאים לך ביום?</span>
          <select className="input" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
            {[5,10,15].map((value) => <option key={value} value={value}>{value} דקות</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="placement" checked={assessment} onChange={() => setAssessment(true)} />אבחון קצר · 6 שאלות</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="placement" checked={!assessment} onChange={() => setAssessment(false)} />בחירת רמת פתיחה בעצמי</label>
        </div>
        {!assessment && <label className="flex flex-col gap-2"><span>רמת פתיחה</span>
          <select className="input" value={level} onChange={(event) => setLevel(event.target.value as LearningLevel)}>
            {LEVELS.map((value) => <option key={value} value={value}>{value}{value === "A0" ? " · מתחילים מהבסיס" : value === "A1" ? " · מתחילים" : value === "A2" ? " · בסיס" : value === "B1" ? " · ביניים" : ""}</option>)}
          </select>
        </label>}
      </fieldset>
      {assessment && <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 font-semibold">איזו תשובה מתאימה?</legend>
        <p className="muted mb-1 text-sm">האבחון נותן הערכת פתיחה עד B1. התשובות נשמרות כתרגול זיהוי; רמות גבוהות יותר אפשר לבחור ידנית.</p>
        {questions.map((question,index) => <div key={index} className="surface flex flex-col gap-2 p-4">
          <p className="muted text-xs">{index+1}/{questions.length}</p>
          <p dir="ltr" lang="en" className="text-start font-semibold">{question.question}</p>
          {question.choices.map((choice,choiceIndex) => <label key={choiceIndex} className={`flex min-h-12 items-center gap-3 rounded-xl border p-3 ${answers[index] === choiceIndex ? "border-accent bg-accent-soft" : "border-line"}`}>
            <input type="radio" name={`question-${index}`} required checked={answers[index] === choiceIndex} onChange={() => setAnswers((previous) => previous.map((answer,i) => i === index ? choiceIndex : answer))} />
            <span dir="ltr" lang="en" className="flex-1 text-start">{choice}</span>
          </label>)}
        </div>)}
      </fieldset>}
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      <button className="btn" disabled={pending}>{pending ? "שומרים…" : "שמירת ההתאמה האישית"}</button>
    </form>
  );
}
