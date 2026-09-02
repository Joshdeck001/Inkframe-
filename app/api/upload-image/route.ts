import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Manual "upload your own" image — for a cover (any project) or an
 * interior chapter image (only meaningful when the project's Step 7
 * choice was "User Upload" or "Mixed", but not restricted to that, since
 * a book on automatic generation may still want to swap in a specific
 * image by hand). The `covers`/`manuscript-images` buckets are
 * server-write-only (no client insert policy — see their migrations), so
 * this route does the actual write with the service-role client, after
 * verifying ownership through the caller's own RLS-scoped session.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const formData = await request.formData();
  const projectId = formData.get("project_id");
  const kind = formData.get("kind");
  const chapterId = formData.get("chapter_id");
  const placementLocation = formData.get("placement_location");
  const file = formData.get("file");

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }
  if (kind !== "cover" && kind !== "interior") {
    return NextResponse.json({ error: "kind must be 'cover' or 'interior'" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 8MB or smaller." }, { status: 400 });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json({ error: "Only PNG, JPEG, GIF, or WebP images are supported." }, { status: 400 });
  }

  // Ownership check runs on the caller's own RLS-scoped session — a row
  // only comes back if this user actually owns the project.
  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const service = createServiceClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (kind === "cover") {
    const path = `${projectId}/manual-cover.${ext}`;
    const { error: uploadError } = await service.storage.from("covers").upload(path, buffer, { contentType: file.type, upsert: true });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
    const {
      data: { publicUrl },
    } = service.storage.from("covers").getPublicUrl(path);

    const { error: upsertError } = await service
      .from("cover_department")
      .upsert({ project_id: projectId, final_cover_ref: publicUrl, source: "user_uploaded" }, { onConflict: "project_id" });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

    return NextResponse.json({ url: publicUrl });
  }

  if (typeof chapterId !== "string" || !chapterId) {
    return NextResponse.json({ error: "chapter_id is required for an interior image" }, { status: 400 });
  }
  const { data: chapter } = await supabase.from("chapters").select("id").eq("id", chapterId).eq("project_id", projectId).single();
  if (!chapter) return NextResponse.json({ error: "Chapter not found on this project" }, { status: 404 });

  const path = `${projectId}/manual-${Date.now()}.${ext}`;
  const { error: uploadError } = await service.storage.from("manuscript-images").upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
  const {
    data: { publicUrl },
  } = service.storage.from("manuscript-images").getPublicUrl(path);

  const { error: insertError } = await service.from("image_placements").insert({
    project_id: projectId,
    chapter_id: chapterId,
    placement_location: typeof placementLocation === "string" && placementLocation.trim() ? placementLocation.trim() : null,
    status: "uploaded",
    file_ref: publicUrl,
  });
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ url: publicUrl });
});

/** Remove a manually uploaded interior placement (cover uploads are just replaced by uploading again). */
export const DELETE = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("image_placements").delete().eq("id", id).eq("status", "uploaded");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
