import { redirect } from "next/navigation";
import { Blob } from "@/components/Blob";
import { BOTS } from "@/lib/bots";
import { getSession } from "@/lib/session";

/** Welcome / sign-in, like Grok Bot's first screen. */
export default async function Welcome(props: PageProps<"/">) {
  if (await getSession()) redirect("/home");
  const params = await props.searchParams;
  const error = typeof params.error === "string" ? params.error : "";

  const crowd = [
    { ...BOTS[0], x: "8%", y: "12%", size: 64, v: 0, d: "0s" },
    { ...BOTS[1], x: "70%", y: "6%", size: 76, v: 1, d: "1.2s" },
    { color: "#fbbf24", accent: "#fde68a", x: "78%", y: "52%", size: 54, v: 2, d: "2s" },
    { color: "#f472b6", accent: "#fbcfe8", x: "4%", y: "60%", size: 50, v: 1, d: "0.6s" },
    { color: "#34d399", accent: "#a7f3d0", x: "40%", y: "70%", size: 44, v: 2, d: "1.6s" },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="relative my-auto h-80 w-full">
        {crowd.map((b, i) => (
          <div key={i} className="floaty absolute" style={{ left: b.x, top: b.y, animationDelay: b.d }}>
            <Blob color={b.color} accent={b.accent} size={b.size} variant={b.v} />
          </div>
        ))}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Blob color="#f4f4f5" accent="#ffffff" size={120} />
        </div>
      </div>

      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Haswell Bots</h1>
        <p className="mt-2 text-muted">Your team of always-on agents that keep your website fresh — and always ask before changing anything.</p>
        {error ? <p className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}
        <a
          href="/api/auth/start"
          className="mt-8 block w-full rounded-full bg-text py-4 text-center font-semibold text-bg transition active:scale-[.98]"
        >
          Sign in
        </a>
        <p className="mt-3 text-xs text-faint">Sign in with your website account.</p>
      </div>
    </main>
  );
}
