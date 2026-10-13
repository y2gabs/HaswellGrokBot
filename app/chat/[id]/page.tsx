import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ChatClient } from "@/components/ChatClient";
import { getSession } from "@/lib/session";

export default async function Chat(props: PageProps<"/chat/[id]">) {
  const session = await getSession();
  if (!session) redirect("/");
  const id = Number((await props.params).id);
  return (
    <AppShell
      siteName={session.site.name}
      siteUrl={session.site.url}
      userName={session.user.displayName}
      activeThreadId={id}
    >
      <ChatClient key={id} id={id} siteName={session.site.name} />
    </AppShell>
  );
}
