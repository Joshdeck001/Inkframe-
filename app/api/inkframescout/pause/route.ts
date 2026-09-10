import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

/**
 * Pause/resume (spec section 5/28) — distinct from Disconnect/Revoke: the
 * credential stays valid, but new observations are rejected server-side
 * (see /api/inkframescout/observations) until the user resumes. Callable
 * from either the extension popup (bearer token) or Settings (session
 * auth via RLS directly) — this route exists for the extension side.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const paused = body.paused === true;

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or revoked." }, { status: 401 });

  await service.from("extension_connections").update({ paused }).eq("id", resolved.connectionId);

  return NextResponse.json({ paused });
});
