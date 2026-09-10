import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Reference images for AI cover editing (moodboard, character reference,
 * an existing cover to improve) — a private, server-write-only bucket
 * distinct from `covers` (final/concept art) and `manuscript-images`
 * (interior), same access pattern as /api/upload-image. Returns a
 * short-lived signed URL immediately since the browser needs to preview
 * what it just uploaded; /api/cover/edit re-downloads the file itself
 * server-side rather than trusting a client-supplied URL.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const formData = await request.formData();
  const projectId = formData.get("project_id");
  const file = formData.get("file");
  if (typeof projectId !== "string" || !projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be 8MB or smaller." }, { status: 400 });
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) return NextResponse.json({ error: "Only PNG, JPEG, or WebP images are supported for reference images." }, { status: 400 });

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const service = createServiceClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const path = `${projectId}/reference-${Date.now()}.${ext}`;
  const { error: uploadError } = await service.storage.from("cover-references").upload(path, buffer, { contentType: file.type });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: signed, error: signError } = await service.storage.from("cover-references").createSignedUrl(path, 3600);
  if (signError || !signed) return NextResponse.json({ error: signError?.message || "Could not create a preview link." }, { status: 500 });

  return NextResponse.json({ path, url: signed.signedUrl });
});
