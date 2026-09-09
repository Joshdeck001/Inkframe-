import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * Signed-URL playback for one narrated chapter — same private-bucket
 * pattern as /api/export-download. `segment` is the audiobook_segments
 * row id; ownership is proven via RLS on that table (owns_audiobook_job)
 * before the service-role client signs the URL.
 */
export const GET = withJsonErrors(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const segmentId = searchParams.get("segment");
  if (!segmentId) return NextResponse.json({ error: "segment is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: segment } = await supabase
    .from("audiobook_segments")
    .select("audio_file_ref, status")
    .eq("id", segmentId)
    .maybeSingle();

  if (!segment?.audio_file_ref || segment.status !== "generated") {
    return NextResponse.json({ error: "This chapter hasn't been narrated yet." }, { status: 404 });
  }

  const service = createServiceClient();
  const { data: signed, error } = await service.storage.from("audiobooks").createSignedUrl(segment.audio_file_ref, 300);
  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Could not create a playback link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
});
