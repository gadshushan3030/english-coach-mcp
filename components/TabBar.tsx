"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "בית", icon: "home" },
  { href: "/cards", label: "כרטיסיות", icon: "cards" },
  { href: "/words", label: "מילים", icon: "list" },
  { href: "/talk", label: "שיחה", icon: "chat" },
  { href: "/progress", label: "התקדמות", icon: "chart" },
];

// Focused screens (a review round, a conversation, one session) hide the bar and show a back button.
const FOCUSED = /^\/(cards|talk|progress\/.+)/;

export function TabBar() {
  const path = usePathname();
  if (FOCUSED.test(path)) return null;

  return (
    <nav aria-label="ניווט ראשי" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-2xl grid-cols-5 px-1.5 pt-2 pb-2">
        {TABS.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-col items-center gap-0.5 text-[11.5px] ${active ? "font-semibold text-accent" : "text-muted"}`}
            >
              <Icon name={t.icon} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
