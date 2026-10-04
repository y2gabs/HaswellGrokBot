import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { HomeClient } from "@/components/HomeClient";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/");
  return <HomeClient siteName={session.site.name} siteUrl={session.site.url} userName={session.user.displayName} />;
}
