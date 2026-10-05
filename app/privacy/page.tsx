export const metadata = { title: "מדיניות פרטיות – English Coach" };

// Public page (proxy.ts lets it through): Google requires a privacy policy URL for the consent screen.
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-5 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold">מדיניות פרטיות</h1>
      <p>English Coach היא אפליקציה ללימוד אנגלית. כל משתמש רואה רק את הנתונים שלו.</p>
      <h2 className="text-lg font-bold">מה נשמר</h2>
      <ul className="list-disc ps-5">
        <li>מכניסה עם Google: השם, כתובת האימייל ותמונת הפרופיל. לא נבקש גישה ל-Gmail, ל-Drive או לכל מידע אחר בחשבון.</li>
        <li>נתוני הלימוד: מילים, כרטיסיות, תשובות שנבדקו, סשני תרגול וציונים.</li>
      </ul>
      <h2 className="text-lg font-bold">איך משתמשים בזה</h2>
      <p>רק כדי להפעיל את האפליקציה: להתחבר, להציג את ההתקדמות ולחבר עוזר (כמו ChatGPT) אם אתם מאשרים זאת. אין פרסומות, אין מכירת מידע ואין שיתוף עם צד שלישי.</p>
      <h2 className="text-lg font-bold">איפה זה נשמר</h2>
      <p>במסד נתונים מנוהל (Postgres) שמארח את האפליקציה ב-Vercel. הגישה לנתונים היא רק דרך השרת, ובכל שאילתה לפי המשתמש המחובר.</p>
      <h2 className="text-lg font-bold">מחיקה ויצירת קשר</h2>
      <p>
        לבקשת מחיקת החשבון וכל הנתונים שלו, או לכל שאלה:{" "}
        <a className="underline" dir="ltr" href="https://github.com/gadshushan3030/english-coach-mcp/issues">GitHub Issues</a>.
      </p>
      <h2 className="text-lg font-bold" dir="ltr">In English</h2>
      <p dir="ltr">
        English Coach stores your Google name, email and profile picture, and your learning data (words, checked answers,
        practice sessions). It is used only to run the app; it is not sold or shared, and each user sees only their own
        data. To delete your account and data, open an issue at the link above.
      </p>
    </main>
  );
}
