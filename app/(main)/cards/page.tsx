import { createClient } from "@/lib/supabase";
import { checkedByWord } from "@/lib/stats";
import { Deck } from "./Deck";

export default async function CardsPage() {
  const supabase = await createClient();
  const [{ data: words }, { data: exercises }] = await Promise.all([
    supabase
      .from("words")
      .select("id, english, hebrew, example")
      .lte("due_at", new Date().toISOString())
      .order("due_at")
      .limit(20),
    supabase.from("exercises").select("word_id, result").not("word_id", "is", null),
  ]);
  const checked = checkedByWord(exercises ?? []);

  return <Deck words={(words ?? []).map((w) => ({ ...w, checked: checked.get(w.id) }))} />;
}
