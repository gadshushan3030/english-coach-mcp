# Gad English

אפליקציה אישית לתרגול אנגלית: כרטיסיות אנגלית–עברית, רשימת מילים, חזרות מרווחות, שיחה יומית בסיסית, דשבורד התקדמות, ושרת MCP שדרכו עוזר חיצוני (למשל ChatGPT) קורא התקדמות ושומר תרגולים.
Next.js 16 + TypeScript, Supabase (Auth + Postgres), פריסה ב־Vercel. ממשק בעברית (RTL), מותאם למק ולאייפון.

## איך זה עובד

- **כניסה** – אימייל + סיסמה דרך Supabase Auth. הרשמה חדשה חסומה, והאפליקציה מכניסה רק את `ALLOWED_EMAIL`. בדיקת הסשן וההפניה ל־`/login` נעשות ב־`proxy.ts`.
- **הרשאות** – RLS על כל הטבלאות: כל שורה שייכת ל־`user_id = auth.uid()`. המפתח היחיד שהאפליקציה מכירה הוא ה־publishable key; אין בה service/secret key בכלל.
- **כרטיסיות** (`/cards`) – עד 20 מילים שהגיע זמנן. ״יודע״ מעלה את המילה קופסה ודוחה אותה ל־1/3/7/14/30/60 ימים; ״צריך לתרגל״ מחזיר אותה לקופסה 0 ולחזרה מיידית. כל סימון נרשם בטבלת `reviews` (הפונקציה `review_word` ב־SQL עושה את שני הדברים בטרנזקציה אחת).
- **מילים** (`/words`) – הוספה ומחיקה של מילים משלך, או 40 מילים בסיסיות בלחיצה אחת מדף הבית.
- **שיחה יומית** (`/talk`) – דיאלוג קצר אחד ליום (מתוך 10, לפי תאריך בשעון ישראל) עם בחירת תשובה, תרגום והשמעה. נשמר כשיחת תרגול רגילה (`source = 'app'`), כל משפט כתרגיל שנבדק.
- **התקדמות** (`/progress`) – כל השיחות (מהאפליקציה ומהעוזר) עם ניקוד, תרגילים מחוץ לשיחה, ורשימת העוזרים המחוברים עם כפתור ניתוק. `/progress/[id]` מציג שיחה אחת: משפטים, תיקונים, מילים חדשות, משוב ותרגילים.
- **השמעה** – דרך `speechSynthesis` של הדפדפן, בלי API חיצוני.

### מה נשמר

| טבלה | מה יש בה |
|---|---|
| `words` | מילה, תרגום, דוגמה, `status` (סימון עצמי), `box` = רמת היכרות 0–6 שקובעת את מועד החזרה |
| `reviews` | **סימון עצמי** מהכרטיסיות (״יודע״ / ״צריך לתרגל״). לא נחשב תשובה שנבדקה |
| `practice_sessions` | שיחה: מזהה, תאריך, נושא, רמה (A0–C2), טקסט/קול, משפטים, תיקונים, מילים חדשות, ניקוד 1–5 (הבנת השאלה, שימוש במילים, דקדוק, הגייה – רק בקול), משוב |
| `exercises` | **תשובה שנבדקה בפועל**: שאלה, תשובה, תשובה צפויה, תוצאה (`correct` / `partial` / `incorrect`), מספר ניסיון, מי בדק |

כל כתיבה מקבלת `request_id`, ויש עליו `unique (user_id, request_id)`. שליחה חוזרת של אותה בקשה מחזירה את השורה הקיימת ולא יוצרת כפילות, וגם לא מזיזה שוב את לוח החזרות של המילה.

```
supabase/migrations/   סכמה, RLS ופונקציות ה־SQL (review_word, start_practice, finish_practice, record_exercise, set_word_familiarity)
proxy.ts               רענון סשן + חסימת כל מי שאינו ALLOWED_EMAIL (לא חל על /mcp ו־/.well-known)
app/mcp/route.ts       שרת ה־MCP: אימות OAuth ואז הכלים מ־lib/mcp.ts
app/oauth/consent/     מסך האישור שאליו Supabase שולח כשעוזר מבקש להתחבר
lib/supabase.ts        Supabase client לצד השרת
lib/content.ts         מילים בסיסיות ודיאלוגים
app/actions.ts         כל ה־Server Actions
app/(main)/            הדפים אחרי כניסה
```

## הרצה מקומית

דרוש: Node 20+, Docker, Supabase CLI.

```bash
npm install
```

```bash
supabase start
```

> הפורטים המקומיים הוזזו ל־553xx (API על `55321`, Studio על `55323`) כדי לא להתנגש בפרויקט Supabase מקומי אחר. realtime, storage, edge functions ו־analytics כבויים מקומית כי האפליקציה לא משתמשת בהם.

```bash
cp .env.example .env.local
```

מלאו ב־`.env.local` את `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` מתוך `supabase status`, ואת `ALLOWED_EMAIL`.

יצירת המשתמש המקומי: Studio ב־http://127.0.0.1:55323 ← Authentication ← Add user ← Create new user (לסמן Auto Confirm).

```bash
npm run dev
```

האפליקציה על http://localhost:3000.

## פריסה

### 1. Supabase

1. יוצרים פרויקט חדש ב־[supabase.com](https://supabase.com/dashboard).
2. מחילים את המיגרציות:

```bash
supabase link --project-ref <project-ref>
```

```bash
supabase db push
```

3. **Authentication ← Sign In / Providers**: מכבים את **Allow new users to sign up**. זה מה שמונע ממישהו אחר לפתוח חשבון.
4. **Authentication ← Users ← Add user ← Create new user**: האימייל והסיסמה שלך, עם Auto Confirm.
5. **Project Settings ← API Keys**: מעתיקים את ה־Project URL ואת ה־publishable key.

> לא להריץ `supabase config push` – זה ידחוף את `site_url` המקומי מ־`supabase/config.toml` לפרויקט האמיתי.

### 2. Vercel

מייבאים את ה־repo ב־[vercel.com/new](https://vercel.com/new) (או `vercel` מהטרמינל) ומגדירים Environment Variables:

| משתנה | ערך |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ה־Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ה־publishable key |
| `ALLOWED_EMAIL` | האימייל שלך |

אחרי הפריסה: ב־Supabase ← Authentication ← URL Configuration, להגדיר את **Site URL** לכתובת של Vercel.

### 3. חיבור עוזר דרך MCP

השרת נמצא ב־`https://<your-app>.vercel.app/mcp` (Streamable HTTP). הוא מקבל רק access token ששרת ה־OAuth של Supabase הנפיק (יש בו `client_id`), של `ALLOWED_EMAIL`, ושהחיבור שלו לא נותק. סשן רגיל של האתר לא מספיק.

**פעם אחת ב־Supabase:**

1. **Authentication ← OAuth Server**: להפעיל, **Authorization Path** = `/oauth/consent`, ולהפעיל **Dynamic Client Registration** (ChatGPT רושם את עצמו לבד).
2. לוודא ש־**Site URL** (שלב 2 למעלה) הוא כתובת ה־Vercel – ממנו Supabase בונה את כתובת מסך האישור.

**ב־ChatGPT** ([הוראות](https://developers.openai.com/plugins/quickstart)):

1. Settings ← Security and login ← להפעיל Developer mode.
2. להוסיף MCP server עם הכתובת `https://<your-app>.vercel.app/mcp`.
3. ChatGPT יפנה לכניסה לאתר ולמסך ״חיבור עוזר לחשבון״. לבדוק ששם האפליקציה וכתובת החזרה נראים נכונים, ולאשר.

ניתוק: `/progress` ← ״עוזרים מחוברים״ ← ניתוק. הגישה נחסמת מיד, גם ל־token שעוד לא פג.

**הכלים:**

| כלי | מה עושה |
|---|---|
| `get_progress` | ספירות, סימון עצמי מול תשובות שנבדקו, מילים לחזרה, 5 שיחות אחרונות |
| `start_practice` | פותח שיחה ומחזיר `practice_id` |
| `save_practice_results` | שומר משפטים, תיקונים, מילים חדשות (נכנסות גם לחפיסה), ניקוד, משוב ותרגילים |
| `record_exercises` | תרגילים מחוץ לשיחה (למשל בוחן מילים); מחזיר `exercise_ids` |
| `add_words` | מוסיף מילים; קיימות לא משתנות |
| `set_word_familiarity` | רמת היכרות 0–6 וקביעת החזרה הבאה |
| `get_practice` / `get_exercises` | קריאה חוזרת לפי מזהה, כדי לוודא שנשמר |

### 4. התקנה כאפליקציה

- **אייפון**: Safari ← שיתוף ← הוספה למסך הבית.
- **מק**: Safari ← File ← Add to Dock.

## סודות

- `.env*` ב־`.gitignore`; רק `.env.example` (בלי ערכים אמיתיים) נכנס לגיט.
- ה־publishable key מיועד להיות חשוף – ההגנה על הנתונים היא RLS.
- ה־secret / service_role key לא נדרש לאפליקציה ואסור לשים אותו ב־Vercel, בקוד או בצ׳אט. גם ה־MCP עובד עם ה־token של המשתמש, כך ש־RLS חל על כל קריאה.

## בדיקת זרימת OAuth מקומית

`supabase/config.toml` מפעיל מקומית את שרת ה־OAuth עם רישום דינמי ו־`site_url = http://localhost:3000`. אחרי שינוי בו: `supabase stop` ואז `supabase start`.
