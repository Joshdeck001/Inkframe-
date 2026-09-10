import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { withCors, corsPreflight } from "@/lib/scout-cors";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;

const SUPPORTED_MARKETPLACES = ["amazon", "google_play_books", "kobo"];

/** Polled by the extension popup on open to show live connection/sync status. */
export const GET = withCors(withJsonErrors(async (request: Request) => {
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

  // "Last known" version info, honestly sourced from the most recent clip
  // this connection actually produced — never a claim about what's
  // currently installed, since the server has no way to know that
  // without the extension telling it via a real clip.
  const { data: lastClip } = await service
    .from("scout_clips")
    .select("extension_version, adapter_version, clipped_at, marketplace")
    .eq("connection_id", resolved.connectionId)
    .order("clipped_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    connected: true,
    connection_state: resolved.paused ? "PAUSED" : "CONNECTED",
    paused: resolved.paused,
    supported_marketplaces: SUPPORTED_MARKETPLACES,
    clips_today: clipsToday ?? 0,
    unassigned_clips: unassigned ?? 0,
    last_extension_version: lastClip?.extension_version ?? null,
    last_adapter_version: lastClip?.adapter_version ?? null,
    last_adapter_marketplace: lastClip?.marketplace ?? null,
    last_sync_at: lastClip?.clipped_at ?? null,
  });
}));
