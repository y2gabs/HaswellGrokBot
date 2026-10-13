"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BotList } from "./BotList";
import { ThemeToggle } from "./ThemeToggle";
import { api } from "@/lib/client";

/**
 * Signed-in layout. Desktop: the assistant list on the left, the open
 * conversation on the right. Mobile: one at a time — the list is the home
 * screen, and a conversation fills the screen with a back button.
 */
export function AppShell({
  siteName,
  siteUrl,
  userName,
  activeThreadId,
  children,
}: {
  siteName: string;
  siteUrl: string;
  userName: string;
  /** Set when a conversation is open; on mobile that hides the list. */
  activeThreadId?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const conversationOpen = activeThreadId !== undefined;

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex h-dvh">
      <aside
        className={`w-full flex-col border-line md:flex md:w-80 md:shrink-0 md:border-r ${
          conversationOpen ? "hidden" : "flex"
        }`}
      >
        <header className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-xs text-faint">Working on</p>
            <a href={siteUrl} target="_blank" rel="noreferrer" className="block truncate font-semibold">
              {siteName}
            </a>
          </div>
          <div className="relative flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setMenu((m) => !m)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-panel-2 font-semibold"
              aria-label="Account"
            >
              {(userName || "?").slice(0, 1).toUpperCase()}
            </button>
            {menu ? (
              <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-2xl border border-line bg-panel p-2 shadow-xl">
                <p className="px-3 py-2 text-sm text-muted">{userName}</p>
                <button onClick={signOut} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-panel-2">
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <h1 className="px-4 pb-2 pt-4 text-sm font-medium text-muted">Your team</h1>
        <nav className="flex-1 overflow-y-auto px-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <BotList activeThreadId={activeThreadId} />
        </nav>
      </aside>

      <section className={`min-w-0 flex-1 ${conversationOpen ? "flex" : "hidden md:flex"}`}>{children}</section>
    </div>
  );
}
