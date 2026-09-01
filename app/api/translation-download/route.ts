import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/**
 * Signed URL for one completed translated edition. Ownership is checked
 * two ways depending on the job's source: an existing project (via RLS-
 * gated project_id lookup) or an uploaded file (the upload path is
 * prefixed with the uploader's user id).
 */
export const GET = withJsonErrors(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job");
  const language = searchParams.get("language");
  if (!jobId || !language) {
    return NextResponse.json({ error: "job and language are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const service = createServiceClient();
  const { data: job } = await service
    .from("translation_jobs")
    .select("source_project_id, source_file, translated_outputs")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  let owns = false;
  if (job.source_project_id) {
    const { data: project } = await supabase.from("projects").select("id").eq("id", job.source_project_id).maybeSingle();
    owns = !!project;
  } else if (job.source_file) {
    owns = job.source_file.startsWith(`${user.id}/`);
  }
  if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const outputs = (job.translated_outputs ?? []) as { language: string; file_ref: string | null }[];
  const output = outputs.find((o) => o.language === language);
  if (!output?.file_ref) {
    return NextResponse.json({ error: "That language isn't ready yet." }, { status: 404 });
  }

  const { data: signed, error } = await service.storage.from("exports").createSignedUrl(output.file_ref, 60);
  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Could not create a download link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
});
