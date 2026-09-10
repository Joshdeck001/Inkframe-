import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

/**
 * Self-disconnect from the extension's own popup ("Disconnect"), using
 * its own bearer token — distinct from revoking a connection out of
 * Settings, which the web UI does directly (RLS already scopes
 * extension_connections to its owner, so no separate API route is
 * needed for that path).
 */
export const POST = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or already revoked." }, { status: 401 });

  await service.from("extension_connections").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", resolved.connectionId);

  return NextResponse.json({ revoked: true });
});
