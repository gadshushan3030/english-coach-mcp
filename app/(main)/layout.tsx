import { TabBar } from "@/components/TabBar";

// Screens that hide the tab bar mark their root with data-focus, which drops the room kept for it.
export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))] has-data-focus:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
      <TabBar />
    </>
  );
}
