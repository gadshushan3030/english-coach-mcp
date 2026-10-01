// Static learning content. Words are copied into the user's own deck on request;
// dialogues are read-only and picked one per day.

export const STARTER_WORDS: { english: string; hebrew: string; example: string }[] = [
  { english: "hello", hebrew: "שלום", example: "Hello, how are you?" },
  { english: "thank you", hebrew: "תודה", example: "Thank you for the coffee." },
  { english: "please", hebrew: "בבקשה", example: "Water, please." },
  { english: "sorry", hebrew: "סליחה", example: "Sorry, I am late." },
  { english: "yes", hebrew: "כן", example: "Yes, I understand." },
  { english: "no", hebrew: "לא", example: "No, thank you." },
  { english: "water", hebrew: "מים", example: "I drink water every day." },
  { english: "coffee", hebrew: "קפה", example: "I like black coffee." },
  { english: "food", hebrew: "אוכל", example: "The food is good." },
  { english: "bread", hebrew: "לחם", example: "I buy bread in the morning." },
  { english: "house", hebrew: "בית", example: "My house is small." },
  { english: "family", hebrew: "משפחה", example: "My family is big." },
  { english: "friend", hebrew: "חבר", example: "He is my friend." },
  { english: "work", hebrew: "עבודה", example: "I go to work by bus." },
  { english: "car", hebrew: "מכונית", example: "The car is red." },
  { english: "street", hebrew: "רחוב", example: "I live on this street." },
  { english: "city", hebrew: "עיר", example: "Tel Aviv is a big city." },
  { english: "day", hebrew: "יום", example: "Have a nice day!" },
  { english: "night", hebrew: "לילה", example: "Good night." },
  { english: "morning", hebrew: "בוקר", example: "Good morning!" },
  { english: "today", hebrew: "היום", example: "Today is Monday." },
  { english: "tomorrow", hebrew: "מחר", example: "See you tomorrow." },
  { english: "time", hebrew: "זמן / שעה", example: "What time is it?" },
  { english: "money", hebrew: "כסף", example: "I don't have money." },
  { english: "shop", hebrew: "חנות", example: "The shop is open." },
  { english: "big", hebrew: "גדול", example: "It is a big dog." },
  { english: "small", hebrew: "קטן", example: "I want a small coffee." },
  { english: "good", hebrew: "טוב", example: "This is very good." },
  { english: "bad", hebrew: "רע", example: "The weather is bad." },
  { english: "hot", hebrew: "חם", example: "It is hot today." },
  { english: "cold", hebrew: "קר", example: "The water is cold." },
  { english: "happy", hebrew: "שמח", example: "I am happy." },
  { english: "tired", hebrew: "עייף", example: "I am tired after work." },
  { english: "to go", hebrew: "ללכת / לנסוע", example: "I go home." },
  { english: "to eat", hebrew: "לאכול", example: "We eat dinner at seven." },
  { english: "to drink", hebrew: "לשתות", example: "Do you want to drink tea?" },
  { english: "to want", hebrew: "לרצות", example: "I want a sandwich." },
  { english: "to like", hebrew: "לאהוב (לחבב)", example: "I like music." },
  { english: "to speak", hebrew: "לדבר", example: "I speak a little English." },
  { english: "to understand", hebrew: "להבין", example: "I don't understand." },
];

// Days until the next review per box 0–6; mirrors box_interval() in db/migrations/0002_app.sql.
export const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60] as const;

export type Turn = {
  they: string; // what the other person says (English)
  theyHe: string; // Hebrew translation
  options: string[]; // possible replies (English)
  answer: number; // index of the natural reply
  answerHe: string; // Hebrew of the natural reply
};

export type Dialogue = { id: string; title: string; turns: Turn[] };

export const DIALOGUES: Dialogue[] = [
  {
    id: "greetings",
    title: "היכרות ראשונה",
    turns: [
      { they: "Hi! How are you?", theyHe: "היי! מה שלומך?", options: ["I'm fine, thanks. And you?", "I am twenty years.", "Yes, please."], answer: 0, answerHe: "אני בסדר, תודה. ומה איתך?" },
      { they: "I'm good. What's your name?", theyHe: "אני בסדר. איך קוראים לך?", options: ["It is Monday.", "My name is Gad.", "I like coffee."], answer: 1, answerHe: "קוראים לי גד." },
      { they: "Nice to meet you, Gad!", theyHe: "נעים להכיר, גד!", options: ["Goodbye, water.", "I don't know.", "Nice to meet you too."], answer: 2, answerHe: "גם לי נעים להכיר." },
    ],
  },
  {
    id: "coffee",
    title: "הזמנה בבית קפה",
    turns: [
      { they: "Hello! What would you like?", theyHe: "שלום! מה להביא לך?", options: ["A coffee, please.", "I am from Israel.", "It is cold."], answer: 0, answerHe: "קפה, בבקשה." },
      { they: "Small or big?", theyHe: "קטן או גדול?", options: ["Yes.", "Small, please.", "At seven."], answer: 1, answerHe: "קטן, בבקשה." },
      { they: "That's ten shekels.", theyHe: "זה עשרה שקלים.", options: ["My name is Dan.", "Good night.", "Here you are. Thank you!"], answer: 2, answerHe: "הנה. תודה!" },
    ],
  },
  {
    id: "where-from",
    title: "מאיפה את/ה?",
    turns: [
      { they: "Where are you from?", theyHe: "מאיפה את/ה?", options: ["I'm from Israel.", "I'm hungry.", "It's five o'clock."], answer: 0, answerHe: "אני מישראל." },
      { they: "Cool! Where do you live?", theyHe: "מגניב! איפה את/ה גר/ה?", options: ["I live in Tel Aviv.", "I like pizza.", "No, thanks."], answer: 0, answerHe: "אני גר/ה בתל אביב." },
      { they: "Do you like it there?", theyHe: "טוב לך לגור שם?", options: ["Yes, I like it a lot.", "I am a teacher.", "See you tomorrow."], answer: 0, answerHe: "כן, מאוד." },
    ],
  },
  {
    id: "time",
    title: "מה השעה?",
    turns: [
      { they: "Excuse me, what time is it?", theyHe: "סליחה, מה השעה?", options: ["It's nine o'clock.", "I'm fine.", "Blue."], answer: 0, answerHe: "השעה תשע." },
      { they: "Thank you! Are you late?", theyHe: "תודה! את/ה מאחר/ת?", options: ["I like cats.", "No, I'm on time.", "It's big."], answer: 1, answerHe: "לא, אני בזמן." },
      { they: "Have a nice day!", theyHe: "שיהיה לך יום נעים!", options: ["You too!", "I'm from Haifa.", "Two coffees."], answer: 0, answerHe: "גם לך!" },
    ],
  },
  {
    id: "shopping",
    title: "בחנות",
    turns: [
      { they: "Can I help you?", theyHe: "אפשר לעזור לך?", options: ["Yes, I'm looking for a shirt.", "It's hot today.", "My name is Tom."], answer: 0, answerHe: "כן, אני מחפש/ת חולצה." },
      { they: "What size?", theyHe: "איזו מידה?", options: ["Medium, please.", "At home.", "Tomorrow."], answer: 0, answerHe: "מידיום, בבקשה." },
      { they: "Here. It's fifty shekels.", theyHe: "הנה. זה חמישים שקלים.", options: ["Good night.", "I'm tired.", "OK, I'll take it."], answer: 2, answerHe: "אוקיי, אני אקח את זה." },
    ],
  },
  {
    id: "weather",
    title: "מזג האוויר",
    turns: [
      { they: "It's so hot today!", theyHe: "כל כך חם היום!", options: ["Yes, it's very hot.", "I'm from Israel.", "A tea, please."], answer: 0, answerHe: "כן, חם מאוד." },
      { they: "Do you like summer?", theyHe: "את/ה אוהב/ת קיץ?", options: ["It's my car.", "No, I like winter more.", "At eight."], answer: 1, answerHe: "לא, אני מעדיף/ה חורף." },
      { they: "Me too. Winter is nice.", theyHe: "גם אני. החורף נעים.", options: ["Where is the bus?", "Yes, I love the rain.", "Thirty shekels."], answer: 1, answerHe: "כן, אני אוהב/ת גשם." },
    ],
  },
  {
    id: "directions",
    title: "איך מגיעים?",
    turns: [
      { they: "Can I help you?", theyHe: "אפשר לעזור לך?", options: ["Yes. Where is the bus station?", "I'm happy.", "It's Sunday."], answer: 0, answerHe: "כן. איפה תחנת האוטובוס?" },
      { they: "Go straight, then turn left.", theyHe: "ממשיכים ישר, ואז פונים שמאלה.", options: ["Straight, then left. Thanks!", "I like red.", "Good morning."], answer: 0, answerHe: "ישר, ואז שמאלה. תודה!" },
      { they: "It's five minutes from here.", theyHe: "זה חמש דקות מכאן.", options: ["My family is big.", "Great, thank you very much!", "No, I'm a doctor."], answer: 1, answerHe: "מעולה, תודה רבה!" },
    ],
  },
  {
    id: "family",
    title: "משפחה",
    turns: [
      { they: "Do you have children?", theyHe: "יש לך ילדים?", options: ["Yes, I have two children.", "It's cold.", "A small coffee."], answer: 0, answerHe: "כן, יש לי שני ילדים." },
      { they: "How old are they?", theyHe: "בני כמה הם?", options: ["They are in Haifa.", "They are five and eight.", "They like pizza."], answer: 1, answerHe: "הם בני חמש ושמונה." },
      { they: "That's so nice!", theyHe: "זה כל כך נחמד!", options: ["Thank you!", "Turn left.", "Ten shekels."], answer: 0, answerHe: "תודה!" },
    ],
  },
  {
    id: "hobbies",
    title: "תחביבים",
    turns: [
      { they: "What do you do in your free time?", theyHe: "מה את/ה עושה בזמן הפנוי?", options: ["I like to read and walk.", "I'm from Israel.", "It's nine o'clock."], answer: 0, answerHe: "אני אוהב/ת לקרוא וללכת ברגל." },
      { they: "Do you play sports?", theyHe: "את/ה עושה ספורט?", options: ["Yes, I play football.", "Yes, a big coffee.", "I live here."], answer: 0, answerHe: "כן, אני משחק/ת כדורגל." },
      { they: "Let's play together sometime!", theyHe: "נשחק ביחד מתישהו!", options: ["It's hot.", "Sure, that sounds great!", "My name is Gad."], answer: 1, answerHe: "בטח, נשמע מעולה!" },
    ],
  },
  {
    id: "restaurant",
    title: "במסעדה",
    turns: [
      { they: "Good evening! A table for how many?", theyHe: "ערב טוב! שולחן לכמה?", options: ["For two, please.", "I'm fine.", "On Monday."], answer: 0, answerHe: "לשניים, בבקשה." },
      { they: "Are you ready to order?", theyHe: "אתם מוכנים להזמין?", options: ["Yes. A salad and fish, please.", "I'm from Tel Aviv.", "Turn right."], answer: 0, answerHe: "כן. סלט ודג, בבקשה." },
      { they: "Anything to drink?", theyHe: "משהו לשתות?", options: ["Just water, please.", "Good night.", "I have two kids."], answer: 0, answerHe: "רק מים, בבקשה." },
    ],
  },
];

export function dialogueForDay(day: string) {
  const n = Math.floor(Date.parse(day) / 86_400_000);
  return DIALOGUES[n % DIALOGUES.length];
}
