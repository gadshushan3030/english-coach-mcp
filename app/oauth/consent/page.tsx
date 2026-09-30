import { redirect } from "next/navigation";
import { decideConnection } from "@/app/actions";
import { createClient } from "@/lib/supabase";

// Supabase's OAuth server sends the owner here to approve an assistant (e.g. ChatGPT) connecting to /mcp.
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  const { authorization_id: id } = await searchParams;
  const supabase = await createClient();
  const { data, error } = typeof id === "string" ? await supabase.auth.oauth.getAuthorizationDetails(id) : { data: null, error: true };

  if (error || !data) return <Shell title="בקשת החיבור לא נמצאה או שפג תוקפה" />;
  if (!("authorization_id" in data)) redirect(data.redirect_url); // approved before

  return (
    <Shell title="חיבור עוזר לחשבון">
      <p>
        <strong dir="auto">{data.client.name || "אפליקציה ללא שם"}</strong> מבקש גישה לנתוני התרגול שלך:
      </p>
      <ul className="muted list-disc ps-5 text-sm">
        <li>קריאת התקדמות ומילים לחזרה</li>
        <li>פתיחת שיחות תרגול ושמירת התוצאות</li>
        <li>הוספת מילים ועדכון רמת ההיכרות</li>
      </ul>
      <p className="muted text-sm">
        חזרה אל: <span dir="ltr" className="break-all">{data.redirect_uri}</span>
      </p>
      <p className="muted text-sm">אם לא אתם התחלתם את החיבור הזה – לדחות.</p>
      <form className="grid grid-cols-2 gap-3">
        <button formAction={decideConnection.bind(null, data.authorization_id, false)} className="btn btn-ghost">דחייה</button>
        <button formAction={decideConnection.bind(null, data.authorization_id, true)} className="btn">אישור</button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
      <section className="surface flex flex-col gap-4 p-6">
        <h1 className="text-xl font-bold">{title}</h1>
        {children}
      </section>
    </main>
  );
}
