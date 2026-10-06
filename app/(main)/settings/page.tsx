import { requireUser } from "@/lib/session";
import { readLearnerProfile } from "@/lib/profile-store";
import { DIAGNOSTIC } from "@/lib/diagnostic";
import { TopBar } from "@/components/TopBar";
import { ProfileForm } from "./ProfileForm";

export default async function SettingsPage() {
  const userId = await requireUser();
  const { profile, configured } = await readLearnerProfile(userId);
  return <>
    <TopBar title="התאמה אישית" />
    <h1 className="text-[26px] font-bold">{configured ? "העדפות הלמידה שלי" : "בונים תרגול שמתאים לך"}</h1>
    <p className="muted text-sm">המטרה והרמה קובעות את נושא השיחה ואת הקושי. הזמן היומי קובע את גודל המקבץ.</p>
    <ProfileForm profile={profile} configured={configured} questions={DIAGNOSTIC.map(({question,choices}) => ({question,choices}))} />
  </>;
}
