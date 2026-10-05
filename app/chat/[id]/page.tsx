import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ChatClient } from "@/components/ChatClient";

export default async function Chat(props: PageProps<"/chat/[id]">) {
  const session = await getSession();
  if (!session) redirect("/");
  const { id } = await props.params;
  return <ChatClient id={Number(id)} siteName={session.site.name} />;
}
