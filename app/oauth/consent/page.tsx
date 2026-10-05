import { sql } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ConsentButtons } from "./ConsentButtons";

// Better Auth sends the signed-in user here when an assistant (e.g. ChatGPT) asks to connect to /mcp.
// The approve/deny request carries the signed query and is verified by Better Auth.
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  await requireUser();
  const { client_id } = await searchParams;
  const [client] =
    typeof client_id === "string"
      ? await sql<{ name: string | null; redirectUris: string[] }>(
          'select name, "redirectUris" from "oauthClient" where "clientId" = $1',
          [client_id],
        )
      : [];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
      <section className="surface flex flex-col gap-4 p-6">
        {client ? (
          <>
            <h1 className="text-xl font-bold">חיבור עוזר לחשבון</h1>
            <p>
              <strong dir="auto">{client.name || "אפליקציה ללא שם"}</strong> מבקש גישה לנתוני התרגול שלך:
            </p>
            <ul className="muted list-disc ps-5 text-sm">
              <li>קריאת התקדמות ומילים לחזרה</li>
              <li>פתיחת שיחות תרגול ושמירת התוצאות</li>
              <li>הוספת מילים ועדכון רמת ההיכרות</li>
            </ul>
            <p className="muted text-sm">
              חזרה אל: <span dir="ltr" className="break-all">{client.redirectUris?.join(", ")}</span>
            </p>
            <p className="muted text-sm">אם לא אתם התחלתם את החיבור הזה – לדחות.</p>
            <ConsentButtons />
          </>
        ) : (
          <h1 className="text-xl font-bold">בקשת החיבור לא נמצאה או שפג תוקפה</h1>
        )}
      </section>
    </main>
  );
}
