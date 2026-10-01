import Link from "next/link";
import { Icon } from "@/components/Icon";

// Header for focused screens (no tab bar): back, title, and an optional counter on the far side.
export function TopBar({ title, back = "/", backLabel = "חזרה לבית", end }: { title: string; back?: string; backLabel?: string; end?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Link href={back} aria-label={backLabel} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface">
        <Icon name="back" size={20} strokeWidth={2} />
      </Link>
      <span className="flex-1 text-center font-semibold">{title}</span>
      <span className="w-11 shrink-0 text-center font-mono text-[13px] text-muted">{end}</span>
    </div>
  );
}
