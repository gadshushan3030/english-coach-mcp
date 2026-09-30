import Link from "next/link";
import { logout } from "@/app/actions";

const NAV = [
  { href: "/", label: "בית" },
  { href: "/cards", label: "כרטיסיות" },
  { href: "/words", label: "מילים" },
  { href: "/talk", label: "שיחה" },
  { href: "/progress", label: "התקדמות" },
] as const;

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <nav className="flex items-center gap-1 overflow-x-auto">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="rounded-xl px-3 py-2.5 font-medium hover:bg-black/5 dark:hover:bg-white/10">
            {n.label}
          </Link>
        ))}
        <form action={logout} className="ms-auto">
          <button className="muted rounded-xl px-3 py-2.5 text-sm hover:bg-black/5 dark:hover:bg-white/10">יציאה</button>
        </form>
      </nav>
      <main className="flex flex-col gap-5">{children}</main>
    </div>
  );
}
