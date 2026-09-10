import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

/**
 * Market Snapshots group clips the user deliberately clicked, one at a
 * time, while comparing a set of books — a label on scout_clips rows
 * (see 0023_inkframescout_snapshots.sql), not a second capture mechanism.
 * Listed here so the extension popup can offer "continue this snapshot"
 * instead of starting a new one on every click.
 */
export const GET = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or revoked." }, { status: 401 });

  const { data: snapshots, error } = await service
    .from("scout_snapshots")
    .select("id, label, created_at")
    .eq("user_id", resolved.userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (snapshots ?? []).map((s) => s.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: clips } = await service.from("scout_clips").select("snapshot_id").in("snapshot_id", ids);
    for (const c of clips ?? []) {
      if (c.snapshot_id) counts[c.snapshot_id] = (counts[c.snapshot_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    snapshots: (snapshots ?? []).map((s) => ({ ...s, clip_count: counts[s.id] ?? 0 })),
  });
});

export const POST = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : "Untitled snapshot";

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or revoked." }, { status: 401 });

  const { data, error } = await service
    .from("scout_snapshots")
    .insert({ user_id: resolved.userId, label })
    .select("id, label, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not create snapshot." }, { status: 500 });

  return NextResponse.json({ snapshot: { ...data, clip_count: 0 } });
});
