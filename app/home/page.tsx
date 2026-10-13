import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Blob } from "@/components/Blob";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/");
  return (
    <AppShell siteName={session.site.name} siteUrl={session.site.url} userName={session.user.displayName}>
      {/* Desktop only: what the right-hand pane shows before a conversation is picked. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <Blob color="var(--hero)" accent="var(--hero-accent)" size={88} />
        <p className="text-lg font-semibold">Pick a teammate to get started</p>
        <p className="max-w-sm text-sm text-muted">Choose an assistant on the left to open your conversation with them.</p>
      </div>
    </AppShell>
  );
}
