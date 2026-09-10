/**
 * CORS for the InkframeScout extension's own API calls.
 *
 * A real gap found during this round's audit: manifest.json's
 * `host_permissions` only covers the three marketplace domains (by
 * design — the extension has no reason to touch InkFrame's own site
 * permissions-wise), and by design the InkFrame URL the extension talks
 * to is whatever the user types into the popup (local dev, staging,
 * production, a self-host) — never one fixed domain a manifest entry
 * could name in advance. Without either a matching host_permissions
 * entry or a CORS header from the server, every fetch() call
 * popup.js makes to these routes would be blocked by the browser's own
 * CORS policy, regardless of a correct bearer token — a failure mode
 * unit tests (or a Node `vm` fake-DOM) can't surface, only a real
 * browser enforcing real CORS can.
 *
 * `Access-Control-Allow-Origin: *` is safe specifically on these routes
 * because every one of them authenticates via an explicit bearer token
 * in the Authorization header (see lib/scout-connection.ts), never
 * cookies or ambient browser credentials — there is nothing for a
 * same-origin policy to protect here that the bearer token doesn't
 * already gate, and these fetches never set `credentials: 'include'`.
 */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function withCors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const res = await handler(request);
    const headers = new Headers(res.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}

/** Handles the preflight OPTIONS request Chrome sends before a cross-origin call carrying an Authorization header. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
