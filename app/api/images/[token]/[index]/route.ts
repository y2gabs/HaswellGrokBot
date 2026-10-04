import { authed, handleError } from "@/lib/api";
import { readCandidate } from "@/lib/ai/images";
import { siteKey } from "@/lib/agent/loop";

/** A generated candidate image, only for the user it was made for. */
export async function GET(request: Request, ctx: RouteContext<"/api/images/[token]/[index]">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const { token, index } = await ctx.params;
  try {
    const image = await readCandidate(siteKey(auth.session), token, Number(index));
    return new Response(new Uint8Array(image.data), {
      headers: { "Content-Type": image.mime, "Cache-Control": "private, max-age=86400" },
    });
  } catch (err) {
    return handleError(err);
  }
}
