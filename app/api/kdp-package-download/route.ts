import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * Short-lived signed URL for a project's generated KDP Ready Package —
 * same private-bucket-plus-signed-URL pattern as /api/export-download,
 * just reading publishing_jobs.package_ref instead of formatting_jobs.
 */
export const GET = withJsonErrors(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project");
  const targetPlatform = searchParams.get("platform");
  if (!projectId || !targetPlatform) return NextResponse.json({ error: "project and platform are required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: job } = await supabase
    .from("publishing_jobs")
    .select("package_ref")
    .eq("project_id", projectId)
    .eq("target_platform", targetPlatform)
    .maybeSingle();
  if (!job?.package_ref) return NextResponse.json({ error: "No KDP Ready Package has been generated yet." }, { status: 404 });

  const service = createServiceClient();
  const { data: signed, error } = await service.storage.from("exports").createSignedUrl(job.package_ref, 60);
  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Could not create a download link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
});
