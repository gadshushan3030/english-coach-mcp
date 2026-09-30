# English Coach

[English](README.md) · עברית

אפליקציה אישית לתרגול אנגלית: כרטיסיות אנגלית–עברית, רשימת מילים, חזרות מרווחות, שיחה יומית בסיסית, דשבורד התקדמות, ושרת MCP שדרכו עוזר חיצוני (למשל ChatGPT) קורא התקדמות ושומר תרגולים.
Next.js 16 + TypeScript, Postgres (Neon בענן), Better Auth, פריסה ב־Vercel. ממשק בעברית (RTL), מותאם למק ולאייפון.

## איך זה עובד

- **כניסה** – אימייל + סיסמה דרך Better Auth. אין הרשמה: את המשתמש יוצרים עם `npm run create-owner`. בנוסף, hook ב־`lib/auth.ts` חוסם יצירת סשן לכל מי שאינו `ALLOWED_EMAIL`.
- **גישה לנתונים** – רק קוד השרת מדבר עם Postgres (ה־connection string קיים רק ב־Vercel), וכל שאילתה ופונקציה מסוננת לפי ה־user id של הבעלים. אין API ציבורי למסד.
- **כרטיסיות** (`/cards`) – ״יודע״ מעלה את המילה קופסה ודוחה אותה ל־1/3/7/14/30/60 ימים; ״צריך לתרגל״ מחזיר לקופסה 0. הסימון נשמר ב־`reviews` (סימון עצמי). בכרטיס מוצג גם ״נבדק: x/y נכונות״ מתוך תשובות שנבדקו בפועל.
- **מילים** (`/words`) – הוספה ומחיקה, או 40 מילים בסיסיות בלחיצה מדף הבית.
- **שיחה יומית** (`/talk`) – דיאלוג קצר אחד ליום (לפי שעון ישראל), נשמר כשיחת תרגול (`source = 'app'`) עם כל משפט כתרגיל שנבדק.
- **התקדמות** (`/progress`) – כל השיחות (מהאפליקציה ומהעוזר) עם ניקוד, תרגילים מחוץ לשיחה, ועוזרים מחוברים עם ניתוק. `/progress/[id]` מציג שיחה אחת במלואה.
- **השמעה** – `speechSynthesis` של הדפדפן.

### מה נשמר

| טבלה | מה יש בה |
|---|---|
| `words` | מילה, תרגום, דוגמה, `status` (סימון עצמי), `box` = רמת היכרות 0–6 שקובעת את מועד החזרה |
| `reviews` | **סימון עצמי** מהכרטיסיות. לא נחשב תשובה שנבדקה |
| `practice_sessions` | שיחה: מזהה, תאריך, נושא, רמה (A0–C2), טקסט/קול, משפטים, תיקונים, מילים חדשות, ניקוד 1–5 (הבנת השאלה, שימוש במילים, דקדוק, הגייה – רק בקול), משוב |
| `exercises` | **תשובה שנבדקה בפועל**: שאלה, תשובה, תשובה צפויה, תוצאה, מספר ניסיון, מי בדק |

כל כתיבה מקבלת `request_id` עם `unique (user_id, request_id)`: שליחה חוזרת מחזירה את השורה הקיימת, בלי כפילות ובלי להזיז שוב את לוח החזרות.

```
db/migrations/        0001: טבלאות Better Auth (נוצר ב-npx auth generate), 0002: טבלאות ופונקציות האפליקציה
scripts/              migrate.mts (מריץ migrations), create-owner.mts (יוצר את המשתמש היחיד)
lib/auth.ts           Better Auth: אימייל+סיסמה, נעילת בעלים, שרת OAuth 2.1 ל-MCP (mcp plugin)
lib/mcp.ts            כלי ה-MCP
app/mcp/route.ts      שרת ה-MCP: אימות token + בדיקה שהחיבור לא נותק
app/oauth/consent/    מסך אישור עוזר
proxy.ts              הפניה ל-/login בלי cookie של סשן
```

## הרצה מקומית

דרוש: Node 22+, Docker.

```bash
npm install
```

```bash
npm run db:up
```

```bash
cp .env.example .env.local
```

ב־`.env.local`: למלא `BETTER_AUTH_SECRET` (פלט של `openssl rand -hex 32`) ואת `ALLOWED_EMAIL`.

```bash
npm run db:migrate
```

```bash
npm run create-owner
```

(שואל סיסמה בלי להציג אותה.)

```bash
npm run dev
```

## פריסה

### 1. מסד נתונים (Neon דרך Vercel)

בפרויקט ב־Vercel: **Storage ← Create Database ← Neon** (Free), ולחבר לפרויקט. זה מוסיף את `DATABASE_URL` ל־Environment Variables.

### 2. משתני סביבה ב־Vercel

| משתנה | ערך |
|---|---|
| `DATABASE_URL` | נוסף אוטומטית ע״י Neon |
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | כתובת הפרודקשן, למשל `https://english-coach-mcp.vercel.app` |
| `ALLOWED_EMAIL` | האימייל שלך |

### 3. סכמה ומשתמש ב־Neon

```bash
vercel env pull .env.production.local --environment=production
```

```bash
node --env-file=.env.production.local scripts/migrate.mts
```

```bash
node --env-file=.env.production.local scripts/create-owner.mts
```

```bash
rm .env.production.local
```

### 4. פריסה

Push ל־`main` (אם GitHub מחובר ל־Vercel) או `vercel --prod`.

### 5. חיבור ChatGPT דרך MCP

1. ChatGPT ← Settings ← Security and login ← **Developer mode**.
2. [chatgpt.com/plugins](https://chatgpt.com/plugins) ← **+** ← הכתובת `https://<your-app>.vercel.app/mcp` ← OAuth.
3. נפתחת כניסה לאתר ואז מסך ״חיבור עוזר לחשבון״. לבדוק ששם האפליקציה וכתובת החזרה (`https://chatgpt.com/...`) נכונים, ולאשר.
4. [personal plugins](https://chatgpt.com/plugins?view=personal) ← **+**. בשיחה: לשונית **Work**, `@` ובחירת ה־plugin.

ChatGPT נרשם לבד (Dynamic Client Registration), עם PKCE. ה־token שהוא מקבל מכוון ל־`<BETTER_AUTH_URL>/mcp` בלבד (`aud`), ו־`/mcp` בודק בכל בקשה שהחיבור עדיין מאושר.
ניתוק: `/progress` ← ״עוזרים מחוברים״ ← ניתוק. מוחק את הלקוח, את האישור ואת כל ה־refresh tokens; גם token שעוד לא פג נדחה מיד.

| כלי | מה עושה |
|---|---|
| `get_progress` | ספירות, סימון עצמי מול תשובות שנבדקו, מילים לחזרה, 5 שיחות אחרונות |
| `start_practice` | פותח שיחה ומחזיר `practice_id` |
| `save_practice_results` | משפטים, תיקונים, מילים חדשות (נכנסות גם לחפיסה), ניקוד, משוב ותרגילים |
| `record_exercises` | תרגילים מחוץ לשיחה; מחזיר `exercise_ids` |
| `add_words` | מוסיף מילים; קיימות לא משתנות |
| `set_word_familiarity` | רמת היכרות 0–6 וקביעת החזרה הבאה |
| `get_practice` / `get_exercises` | קריאה חוזרת לפי מזהה, לאימות השמירה |

### 6. התקנה כאפליקציה

- **אייפון**: Safari ← שיתוף ← הוספה למסך הבית.
- **מק**: Safari ← File ← Add to Dock.

## סודות

- `.env*` ב־`.gitignore`; רק `.env.example` בלי ערכים נכנס לגיט.
- `DATABASE_URL` ו־`BETTER_AUTH_SECRET` הם סודות: רק ב־Vercel וב־`.env.local` המקומי, אף פעם לא בקוד, בדפדפן או בצ׳אט.
- העוזר לא מקבל שום מפתח: רק access token קצר מועד (שעה) ו־refresh token, שניהם אחרי אישור שלך.
