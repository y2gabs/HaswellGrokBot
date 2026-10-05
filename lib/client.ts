"use client";

/** Fetch JSON from this app's API; on 401 go back to sign-in. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // A full reload, so no stale signed-in state survives.
    window.location.replace(new URL("/?error=" + encodeURIComponent(data.error || "Please sign in again."), window.location.origin));
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data as T;
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
