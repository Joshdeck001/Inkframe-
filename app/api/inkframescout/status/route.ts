import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

const SUPPORTED_MARKETPLACES = ["amazon", "google_play_books", "kobo"];

/** Polled by the extension popup on open to show live connection/sync status. */
export const GET = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or revoked." }, { status: 401 });

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const { count: clipsToday } = await service
    .from("scout_clips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", resolved.userId)
    .gte("clipped_at", since.toISOString());

  const { count: unassigned } = await service
    .from("scout_clips")
    .select("id", { count: "exact", head: true })
    .eq("user_id", resolved.userId)
    .eq("status", "unassigned");

  return NextResponse.json({
    connected: true,
    supported_marketplaces: SUPPORTED_MARKETPLACES,
    clips_today: clipsToday ?? 0,
    unassigned_clips: unassigned ?? 0,
  });
});
