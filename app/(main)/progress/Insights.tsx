import Link from "next/link";
import { getProgressInsights } from "@/lib/progress-insights";

export async function Insights({userId}:{userId:string}) {
  const {mistakes,retention,activity}=await getProgressInsights(userId);
  return <section className="surface flex flex-col gap-4 p-5">
    <div className="flex flex-col gap-1"><h2 className="text-lg font-bold">מה לתרגל עכשיו?</h2>
      <p className="muted text-sm">בשבעת הימים האחרונים: {activity.days} ימי תרגול · {activity.attempts} תשובות שנבדקו</p>
    </div>
    {mistakes.length ? <ol className="flex flex-col gap-3">
      {mistakes.map((mistake) => <li key={mistake.id} className="flex flex-col gap-1.5 rounded-xl bg-ground p-3">
        <p dir="auto" className="font-medium">{mistake.question}</p>
        <p className="text-sm">{mistake.explanation_he}</p>
        <p className="muted text-xs">{mistake.errors} תשובות שגויות השבוע · {mistake.due ? "הגיע הזמן לחזרה" : "החזרה הבאה מתוזמנת"}</p>
        {mistake.due && <Link href={`/practice?section=reviews&focus=${mistake.id}`} className="self-start text-sm font-semibold text-accent underline underline-offset-4">לתרגול ממוקד</Link>}
      </li>)}
    </ol> : <p className="muted text-sm">אין כרגע טעויות אישיות שנרשמו השבוע. אחרי שאלות מהשיחות, יוצעו כאן נושאים לחזרה.</p>}
    <div className="border-t border-line pt-3">
      <h3 className="font-semibold">זכירה אחרי שבוע</h3>
      <p className="mt-1 text-sm">{retention.tested ? `${retention.remembered}/${retention.tested} מילים נענו נכון בבדיקה האחרונה, לפחות שבוע אחרי בדיקה קודמת.` : "המדד יופיע כשמילים ייבדקו שוב לפחות שבוע אחרי בדיקה קודמת."}</p>
      <p className="muted mt-1 text-xs">מבוסס על תשובות שנבדקו בפועל; סימון „יודע” בכרטיסיות נשמר בנפרד.</p>
    </div>
    <Link href="/practice" className="btn">לתרגול שלי להיום</Link>
  </section>;
}
