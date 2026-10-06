import { DIALOGUES, type Dialogue, type Turn } from "./content";

export type LearningGoal = "everyday" | "work" | "travel";
export type LearningLevel = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type LearningProfile = { goal: LearningGoal; level: LearningLevel };
export type AdaptiveDialogue = Dialogue & LearningProfile;

type Row = [they: string, theyHe: string, reply: string, replyHe: string, wrongA: string, wrongB: string];

function makeDialogue(id: string, goal: LearningGoal, level: LearningLevel, title: string, rows: Row[]): AdaptiveDialogue {
  return {
    id, goal, level, title,
    turns: rows.map(([they, theyHe, reply, answerHe, wrongA, wrongB], index): Turn => {
      const answer = index % 3;
      const options = [wrongA, wrongB];
      options.splice(answer, 0, reply);
      return { they, theyHe, options, answer, answerHe };
    }),
  };
}

// Short, authored dialogues cover four bands. A0/A1 share basics, A2/B1 share
// everyday problem solving, and C1/C2 share nuanced discussion; these are practice
// bands rather than a formal CEFR assessment.
export const ADAPTIVE_DIALOGUES: AdaptiveDialogue[] = [
  makeDialogue("everyday-a1-weekend", "everyday", "A1", "תוכניות לסוף השבוע", [
    ["What do you do on Saturday?", "מה עושים בשבת?", "I visit my family.", "אני מבקר/ת את המשפחה שלי.", "It is a blue bag.", "The bus is late."],
    ["Do you like walking?", "את/ה אוהב/ת ללכת ברגל?", "Yes, I like walking in the park.", "כן, אני אוהב/ת ללכת בפארק.", "My name is a park.", "At three brothers."],
    ["Let's meet at ten.", "ניפגש בעשר.", "Great. See you at ten!", "מעולה. נתראה בעשר!", "It costs ten.", "I have ten years."],
  ]),
  makeDialogue("everyday-a1-neighbour", "everyday", "A1", "שכנים חדשים", [
    ["Hi, I live next door.", "היי, אני גר/ה לידך.", "Hello! Nice to meet you.", "שלום! נעים להכיר.", "I need two tickets.", "It is cold coffee."],
    ["Do you have a dog?", "יש לך כלב?", "Yes, I have a small dog.", "כן, יש לי כלב קטן.", "Yes, I am a dog.", "I at home yesterday."],
    ["Have a good evening!", "שיהיה לך ערב נעים!", "Thank you. You too!", "תודה. גם לך!", "I am evening.", "Three dogs, please."],
  ]),
  makeDialogue("everyday-a2-plans", "everyday", "A2", "שינוי תוכניות", [
    ["Can we meet a little later?", "אפשר להיפגש קצת יותר מאוחר?", "Sure. Would six o'clock work?", "בטח. השעה שש מתאימה?", "I meet yesterday at six.", "Six is on the table."],
    ["I have to pick up my sister first.", "קודם אני צריך/ה לאסוף את אחותי.", "No problem. I'll wait at the café.", "אין בעיה. אחכה בבית הקפה.", "I waited tomorrow.", "My sister is six o'clock."],
    ["Thanks for being flexible.", "תודה על הגמישות.", "You're welcome. See you soon!", "בשמחה. נתראה בקרוב!", "I am flexible yesterday.", "You are thanks."],
  ]),
  makeDialogue("everyday-a2-return", "everyday", "A2", "להחליף מוצר", [
    ["What seems to be the problem?", "מה הבעיה?", "I bought this yesterday, but it doesn't work.", "קניתי את זה אתמול, אבל זה לא עובד.", "I buy it yesterday and it don't work.", "I bought tomorrow and it works yesterday."],
    ["Do you still have the receipt?", "עדיין יש לך קבלה?", "Yes, I kept it in my bag.", "כן, שמרתי אותה בתיק שלי.", "Yes, I keeping it last week.", "No, the bag is a receipt."],
    ["Would you prefer a replacement or a refund?", "מעדיפים החלפה או החזר?", "I'd like a refund, please.", "אשמח להחזר, בבקשה.", "I'd like refunded yesterday will.", "I am a refund."],
  ]),
  makeDialogue("everyday-b2-disagreement", "everyday", "B2", "אי הסכמה נעימה", [
    ["I think we should cancel the outdoor event.", "לדעתי כדאי לבטל את האירוע בחוץ.", "I see your point, but could we move it indoors instead?", "אני מבין/ה, אבל אולי נעביר אותו פנימה במקום?", "I see your point, but could we moved it indoors?", "We should to cancel everything yesterday."],
    ["I'm worried that the room will be too crowded.", "אני חושש/ת שיהיה צפוף מדי בחדר.", "That's a fair concern. We could limit the number of guests.", "זה חשש מוצדק. אפשר להגביל את מספר האורחים.", "That's a fair concern. We could limiting the guests.", "The guests limits the room yesterday will."],
    ["Let's check the room before making a decision.", "נבדוק את החדר לפני שנחליט.", "Agreed. Then we can weigh the options properly.", "מסכים/ה. כך נוכל לשקול את האפשרויות כמו שצריך.", "Agreed. Then we can weighed the options.", "We had decide tomorrow before checking."],
  ]),
  makeDialogue("everyday-b2-habit", "everyday", "B2", "הרגל חדש", [
    ["Have you managed to stick to your new routine?", "הצלחת להתמיד בשגרה החדשה?", "Mostly, although I've had to adjust it on busy days.", "לרוב כן, אם כי הייתי צריך/ה להתאים אותה בימים עמוסים.", "Mostly, although I've had adjust it on busy days.", "I sticked tomorrow to my yesterday routine."],
    ["What has made the biggest difference?", "מה עשה את ההבדל הגדול ביותר?", "Setting a realistic goal has helped me stay consistent.", "הצבת מטרה מציאותית עזרה לי להתמיד.", "Setting a realistic goal have helped me stays consistent.", "Set a goal has helping yesterday tomorrow."],
    ["Would you recommend starting with a small goal?", "ממליצים להתחיל במטרה קטנה?", "Definitely. It's easier to build on a habit than to change everything at once.", "בהחלט. קל יותר לבנות על הרגל מאשר לשנות הכול בבת אחת.", "Definitely. It's easier building than to changing everything.", "No goal exists in the sentence about the weather."],
  ]),
  makeDialogue("everyday-c1-perspective", "everyday", "C1", "להציג נקודת מבט מורכבת", [
    ["Do you think the neighbourhood's changes have been entirely positive?", "השינויים בשכונה היו חיוביים לגמרי לדעתך?", "On balance, yes, though that overlooks the pressure on long-term residents.", "בסיכומו של דבר כן, אם כי זה מתעלם מהלחץ על התושבים הוותיקים.", "On balance, yes, though that overlook the pressure on residents.", "Yes, because entirely positive means no residents exist."],
    ["Isn't higher investment bound to benefit everyone?", "ההשקעה הגדלה לא אמורה להועיל לכולם?", "Not necessarily; the benefits depend on how the investment is distributed.", "לא בהכרח; התועלת תלויה באופן חלוקת ההשקעה.", "Not necessarily; the benefits depends on how investment distributed.", "Certainly; a benefit and a disadvantage are always identical."],
    ["What would a more balanced approach look like?", "איך תיראה גישה מאוזנת יותר?", "It would combine improvements with measures that keep housing accessible.", "היא תשלב שיפורים עם צעדים שישאירו את הדיור נגיש.", "It would combines improvements with measures that keeps housing accessible.", "It would ignoring every improvement and every resident."],
  ]),
  makeDialogue("everyday-c1-boundaries", "everyday", "C1", "להציב גבולות בנימוס", [
    ["Could you take on the organising again this year?", "תוכל/י לקחת שוב את הארגון השנה?", "I'd be happy to advise, but I can't commit to coordinating the whole event.", "אשמח לייעץ, אבל איני יכול/ה להתחייב לתיאום האירוע כולו.", "I'd be happy advising, but I can't commit to coordinate the whole event.", "Yes, I refuse while accepting all responsibility."],
    ["We were counting on your experience.", "סמכנו על הניסיון שלך.", "I appreciate that. Perhaps I could help someone else get started.", "אני מעריך/ה את זה. אולי אוכל לעזור למישהו אחר להתחיל.", "I appreciate that. Perhaps I could helps someone else getting started.", "Experience means I have unlimited time."],
    ["Would a short handover meeting be possible?", "אפשר לקיים פגישת חפיפה קצרה?", "Yes, provided we agree on the scope in advance.", "כן, בתנאי שנסכים מראש על ההיקף.", "Yes, provided we agrees on the scope in advance.", "Yes, provided agreeing had we scope."],
  ]),
  makeDialogue("work-a1-introduction", "work", "A1", "היום הראשון בעבודה", [
    ["Hello! Are you new here?", "שלום! את/ה חדש/ה כאן?", "Yes. Today is my first day.", "כן. היום הוא היום הראשון שלי.", "Yes. I am first yesterday.", "A return ticket, please."],
    ["What team are you on?", "באיזה צוות את/ה?", "I'm on the support team.", "אני בצוות התמיכה.", "I am team at five.", "It's a red shirt."],
    ["Do you need any help?", "צריך עזרה?", "Yes, please. Where is my desk?", "כן, בבקשה. איפה השולחן שלי?", "I am desk.", "My help is twenty years."],
  ]),
  makeDialogue("work-a1-meeting", "work", "A1", "לקבוע פגישה", [
    ["Are you free at two?", "את/ה פנוי/ה בשתיים?", "Yes, I'm free at two.", "כן, אני פנוי/ה בשתיים.", "Yes, I'm two free years.", "I live on two."],
    ["Let's meet in room five.", "ניפגש בחדר חמש.", "OK. Where is room five?", "בסדר. איפה חדר חמש?", "Five is my lunch.", "I five meet room."],
    ["It's next to the kitchen.", "הוא ליד המטבח.", "Thank you. See you there!", "תודה. נתראה שם!", "I am kitchen next.", "The train is tomorrow."],
  ]),
  makeDialogue("work-a2-update", "work", "A2", "עדכון קצר לצוות", [
    ["How is the task going?", "איך מתקדמת המשימה?", "I've finished the first part, and I'm checking the rest.", "סיימתי את החלק הראשון ואני בודק/ת את השאר.", "I've finish the first part, and I checking the rest.", "I finished tomorrow before I start yesterday."],
    ["Will it be ready by tomorrow?", "זה יהיה מוכן עד מחר?", "Yes, if I get the missing information today.", "כן, אם אקבל את המידע החסר היום.", "Yes, if I gets the missing information today.", "It was ready next tomorrow at yesterday."],
    ["Let me know if you need anything.", "עדכן/י אותי אם צריך משהו.", "Thanks. Could you send me the latest file?", "תודה. אפשר לשלוח לי את הקובץ האחרון?", "Thanks. Could you sent me the latest file?", "Thanks. The file send I yesterday will."],
  ]),
  makeDialogue("work-a2-clarify", "work", "A2", "לבקש הבהרה", [
    ["Please send the summary before lunch.", "בבקשה לשלוח את הסיכום לפני ארוחת הצהריים.", "Sure. Should I include the figures as well?", "בטח. לכלול גם את הנתונים?", "Sure. Should I includes the figures as well?", "Sure. I included tomorrow yesterday lunch."],
    ["Just the main points for now.", "כרגע רק את הנקודות העיקריות.", "Got it. I'll keep it short.", "הבנתי. אקצר.", "Got it. I'll keeps it short.", "Got it. I short kept will."],
    ["Can you also share it with the team?", "אפשר גם לשתף את הצוות?", "Of course. I'll send everyone a copy.", "כמובן. אשלח לכולם עותק.", "Of course. I'll sends everyone a copy.", "Of course. Everyone copy send yesterday will."],
  ]),
  makeDialogue("work-b2-priority", "work", "B2", "לתאם עדיפויות", [
    ["Can we fit another request into this week's plan?", "אפשר להכניס עוד בקשה לתוכנית השבוע?", "We could, but we'd need to postpone something else.", "אפשר, אבל נצטרך לדחות משהו אחר.", "We could, but we'd need postpone something else.", "We could, but postponed need we something."],
    ["Which item would you suggest moving?", "איזה פריט כדאי להזיז לדעתך?", "I'd move the report, since the customer issue is more urgent.", "הייתי מזיז/ה את הדוח, כי בעיית הלקוח דחופה יותר.", "I'd moving the report, since the issue are more urgent.", "I will move yesterday report before tomorrow started."],
    ["Let's confirm that with the stakeholders.", "נאשר את זה עם בעלי העניין.", "Agreed. I'll explain the trade-off and ask for their input.", "מסכים/ה. אסביר את הפשרה ואבקש את דעתם.", "Agreed. I'll explaining the trade-off and asks for their input.", "Agreed. Their input explain we trade."],
  ]),
  makeDialogue("work-b2-feedback", "work", "B2", "לתת משוב מועיל", [
    ["What did you think of my presentation?", "מה דעתך על המצגת שלי?", "The structure was clear; a concrete example would make the conclusion stronger.", "המבנה היה ברור; דוגמה מוחשית תחזק את המסקנה.", "The structure were clear; an example would makes it stronger.", "A presentation is an unrelated train station."],
    ["Was the middle section too detailed?", "החלק האמצעי היה מפורט מדי?", "A little. You could move some of the detail to an appendix.", "קצת. אפשר להעביר חלק מהפרטים לנספח.", "A little. You could moved some of the detail.", "The details moves yesterday into tomorrow."],
    ["Thanks. Could you review the next version?", "תודה. אפשר לבדוק את הגרסה הבאה?", "Certainly. Send it over once you've made those changes.", "בהחלט. שלח/י אותה אחרי שתבצע/י את השינויים האלה.", "Certainly. Send it over once you has made those changes.", "Certainly. Had changes makes version sends."],
  ]),
  makeDialogue("work-c1-risk", "work", "C1", "להציג סיכון והמלצה", [
    ["Do the results justify a full rollout?", "התוצאות מצדיקות השקה מלאה?", "They're encouraging, but I'd be cautious about extrapolating from such a small sample.", "הן מעודדות, אבל הייתי נזהר/ת מהסקת מסקנות ממדגם כה קטן.", "They're encouraging, but I'd be cautious about extrapolate from a sample.", "A small sample guarantees every possible outcome."],
    ["What would give you more confidence?", "מה ייתן לך יותר ביטחון?", "A broader pilot would help us distinguish a reliable trend from a one-off effect.", "ניסוי רחב יותר יעזור להבחין בין מגמה אמינה לאפקט חד פעמי.", "A broader pilot would helps us distinguishes a trend.", "Confidence requires ignoring all results."],
    ["How would you frame the recommendation?", "איך היית מציג/ה את ההמלצה?", "Proceed in stages, with explicit criteria for expanding or pausing the rollout.", "להתקדם בשלבים, עם קריטריונים ברורים להרחבת ההשקה או עצירתה.", "Proceed in stages, with criteria for expand or paused the rollout.", "Proceed by pausing expansion while expanding every pause."],
  ]),
  makeDialogue("work-c1-negotiate", "work", "C1", "משא ומתן על היקף עבודה", [
    ["We need the entire package delivered by Friday.", "אנחנו צריכים את החבילה כולה עד יום שישי.", "We can meet that date if we narrow the scope to the essential elements.", "נוכל לעמוד במועד אם נצמצם את ההיקף לרכיבים החיוניים.", "We can meet that date if we narrows the scope.", "We can deliver before starting without any work."],
    ["I'd rather avoid reducing the scope.", "אני מעדיף/ה להימנע מצמצום ההיקף.", "In that case, we'd need either additional capacity or a revised deadline.", "במקרה כזה נזדקק לתוספת משאבים או למועד חדש.", "In that case, we'd needs either capacity or revised a deadline.", "In that case, capacity means the date cannot exist."],
    ["Could you outline both options?", "אפשר לפרט את שתי האפשרויות?", "Certainly. I'll set out the implications so we can make an informed decision.", "בהחלט. אפרט את ההשלכות כדי שנוכל לקבל החלטה מושכלת.", "Certainly. I'll set out the implications so we can makes a decision.", "Certainly. An informed decision requires no information."],
  ]),
  makeDialogue("travel-a1-hotel", "travel", "A1", "צ'ק אין במלון", [
    ["Hello. Do you have a booking?", "שלום. יש לך הזמנה?", "Yes. I have a booking for two nights.", "כן. יש לי הזמנה לשני לילות.", "Yes. I am booking two nights.", "The meeting is at my desk."],
    ["May I see your passport?", "אפשר לראות את הדרכון שלך?", "Of course. Here it is.", "כמובן. הנה הוא.", "I am passport.", "Passport is two nights."],
    ["Breakfast is at seven.", "ארוחת הבוקר בשבע.", "Thank you. Where is the restaurant?", "תודה. איפה המסעדה?", "Thank you. I am seven restaurant.", "Tomorrow is a passport."],
  ]),
  makeDialogue("travel-a1-ticket", "travel", "A1", "לקנות כרטיס רכבת", [
    ["Where would you like to go?", "לאן רוצים לנסוע?", "To the airport, please.", "לשדה התעופה, בבקשה.", "I am airport yesterday.", "A meeting for work."],
    ["One ticket or two?", "כרטיס אחד או שניים?", "One ticket, please.", "כרטיס אחד, בבקשה.", "One is ticket I.", "I live in coffee."],
    ["The train leaves at nine.", "הרכבת יוצאת בתשע.", "Which platform is it?", "מאיזה רציף?", "I am nine platform.", "My ticket is a family."],
  ]),
  makeDialogue("travel-a2-missed", "travel", "A2", "לפספס רכבת", [
    ["Why do you need another ticket?", "למה צריך עוד כרטיס?", "I missed my train because the bus was late.", "פספסתי את הרכבת כי האוטובוס איחר.", "I miss my train yesterday because the bus were late.", "I will missed my train before yesterday."],
    ["The next train leaves in an hour.", "הרכבת הבאה יוצאת בעוד שעה.", "Can I use my original ticket?", "אפשר להשתמש בכרטיס המקורי שלי?", "Can I used my original ticket?", "Can my ticket uses I?"],
    ["Yes, but you need a new seat reservation.", "כן, אבל צריך הזמנת מושב חדשה.", "How much does the reservation cost?", "כמה עולה הזמנת המושב?", "How much do the reservation costs?", "How many price is reservations?"],
  ]),
  makeDialogue("travel-a2-room", "travel", "A2", "בעיה בחדר", [
    ["How can I help you?", "איך אפשר לעזור?", "The air conditioning in my room isn't working.", "המזגן בחדר שלי לא עובד.", "The air conditioning in my room don't working.", "My room works air yesterday."],
    ["We'll send someone up soon.", "נשלח מישהו בקרוב.", "Thank you. How long will it take?", "תודה. כמה זמן זה ייקח?", "Thank you. How long will it takes?", "How much time does taking will?"],
    ["About half an hour. Would you like another room?", "בערך חצי שעה. רוצים חדר אחר?", "Yes, please, if one is available.", "כן, בבקשה, אם יש חדר פנוי.", "Yes, please, if one are available.", "Yes, if available were room tomorrow yesterday."],
  ]),
  makeDialogue("travel-b2-disruption", "travel", "B2", "שינוי בטיסה", [
    ["Your connecting flight has been cancelled.", "טיסת ההמשך שלך בוטלה.", "Could you explain the alternatives and whether accommodation is included?", "אפשר להסביר את החלופות והאם לינה כלולה?", "Could you explains the alternatives and whether accommodation included?", "The flight cancellation means my desk is at seven."],
    ["We can rebook you for tomorrow morning.", "אפשר להזמין לך מחדש למחר בבוקר.", "Would that get me there before midday? I have a time-sensitive appointment.", "זה יביא אותי לפני הצהריים? יש לי פגישה שחייבת להתקיים בזמן.", "Would that gets me there before midday?", "I arrived tomorrow before the flight will left."],
    ["There's also a route through another airport.", "יש גם מסלול דרך שדה תעופה אחר.", "I'd consider that if the connection time is realistic.", "אשקול את זה אם זמן הקונקשן סביר.", "I'd considered that if the connection time are realistic.", "Connection time is irrelevant to making a connection."],
  ]),
  makeDialogue("travel-b2-local", "travel", "B2", "לקבל עצה ממקומיים", [
    ["Are you looking for somewhere lively or somewhere quiet?", "מחפשים מקום תוסס או מקום שקט?", "Somewhere quiet, ideally within walking distance of the centre.", "מקום שקט, רצוי במרחק הליכה מהמרכז.", "Somewhere quiet, ideally within walk distance of the centre.", "A quiet place means the train was cancelled."],
    ["There's a market nearby, though it gets busy later.", "יש שוק קרוב, אבל הוא מתמלא בהמשך היום.", "Would it be worth going early to avoid the crowds?", "כדאי להגיע מוקדם כדי להימנע מההמונים?", "Would it be worth to go early to avoid the crowds?", "It worth goes early avoid crowded tomorrow yesterday."],
    ["Absolutely. Most stalls open around eight.", "בהחלט. רוב הדוכנים נפתחים בסביבות שמונה.", "Perfect. I'll head there first and explore the area afterwards.", "מעולה. אלך לשם קודם ואז אטייל באזור.", "Perfect. I'll heads there first and exploring afterwards.", "Perfect. Afterwards will happened before first yesterday."],
  ]),
  makeDialogue("travel-c1-resolve", "travel", "C1", "לפתור אי הבנה בהזמנה", [
    ["Our records show that you booked a non-refundable rate.", "ברישומים שלנו מופיעה הזמנה ללא אפשרות החזר.", "I understand the policy, but the confirmation I received explicitly stated otherwise.", "אני מבין/ה את המדיניות, אבל האישור שקיבלתי ציין במפורש אחרת.", "I understand the policy, but the confirmation I received explicitly state otherwise.", "I understand the policy because confirmation and cancellation are identical."],
    ["Could you show me the confirmation?", "אפשר לראות את האישור?", "Certainly. This section appears to allow changes up to forty-eight hours before arrival.", "בהחלט. לפי הסעיף הזה נראה שמותר לשנות עד ארבעים ושמונה שעות לפני ההגעה.", "Certainly. This section appear to allows changes before arrival.", "Certainly. Forty-eight hours always means after the arrival."],
    ["I'll ask a manager to review the discrepancy.", "אבקש ממנהל/ת לבדוק את הפער.", "Thank you. I'd appreciate a written explanation of whichever resolution is agreed.", "תודה. אשמח להסבר בכתב על הפתרון שעליו נסכים.", "Thank you. I'd appreciate a written explanation of whichever resolution are agreed.", "Thank you. A written explanation requires no words or agreement."],
  ]),
  makeDialogue("travel-c1-responsible", "travel", "C1", "לטייל בהתחשבות", [
    ["Has tourism changed the character of this town?", "התיירות שינתה את האופי של העיירה הזאת?", "It seems to have brought opportunities, albeit at a cost to some local traditions.", "נראה שהיא הביאה הזדמנויות, אם כי במחיר של חלק מהמסורות המקומיות.", "It seem to have brought opportunities, albeit at a cost to traditions.", "Tourism proves local traditions never existed anywhere."],
    ["How can visitors contribute more responsibly?", "איך מבקרים יכולים לתרום באחריות רבה יותר?", "Supporting locally owned businesses is a start, provided their practices are respectful too.", "תמיכה בעסקים מקומיים היא התחלה, בתנאי שגם הפעילות שלהם מכבדת.", "Supporting locally owned businesses are a start, provided their practices is respectful.", "Contributing responsibly means never considering any impact."],
    ["Would staying longer make a difference?", "שהייה ארוכה יותר תעשה הבדל?", "Potentially, though the quality of engagement matters as much as the length of the visit.", "אולי, אם כי איכות המעורבות חשובה לא פחות ממשך הביקור.", "Potentially, though the quality of engagement matter as much as the length.", "Potentially, because the visit's length makes every action identical."],
  ]),
];

export const ALL_DIALOGUES: Dialogue[] = [...DIALOGUES, ...ADAPTIVE_DIALOGUES];

export function resolveDialogue(id: string): Dialogue | undefined {
  return ALL_DIALOGUES.find((dialogue) => dialogue.id === id);
}

export function dialogueMetadata(id: string): LearningProfile {
  const dialogue = ADAPTIVE_DIALOGUES.find((item) => item.id === id);
  return dialogue ? { goal: dialogue.goal, level: dialogue.level } : { goal: "everyday", level: "A1" };
}

function band(level: LearningLevel): LearningLevel {
  if (level === "A0" || level === "A1") return "A1";
  if (level === "A2" || level === "B1") return "A2";
  if (level === "C1" || level === "C2") return "C1";
  return "B2";
}

function dialoguesForProfile(profile: LearningProfile): Dialogue[] {
  const level = band(profile.level);
  const options: Dialogue[] = ADAPTIVE_DIALOGUES.filter((dialogue) => dialogue.goal === profile.goal && dialogue.level === level);
  // Keep the original beginner catalogue available for daily-life learners.
  if (profile.goal === "everyday" && level === "A1") options.push(...DIALOGUES);
  return options.length > 0 ? options : DIALOGUES;
}

export function chooseAdaptiveDialogue(day: string, profile: LearningProfile): Dialogue {
  const options = dialoguesForProfile(profile);
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  const dayNumber = Number.isFinite(timestamp) ? Math.floor(timestamp / 86_400_000) : 0;
  const selected = ((dayNumber % options.length) + options.length) % options.length;
  return options[selected];
}

export function nextAdaptiveDialogue(currentId: string, profile: LearningProfile): Dialogue {
  const options = dialoguesForProfile(profile);
  const index = options.findIndex((dialogue) => dialogue.id === currentId);
  return options[(index + 1) % options.length];
}
