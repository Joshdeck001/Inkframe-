import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";

export const dynamic = "force-dynamic";

/**
 * Returns a short-lived signed URL for a project's exported file. The
 * `exports` bucket is private, so this is the only way to reach it — the
 * caller's session proves they own the project (via RLS on formatting_jobs)
 * before the service-role client is used to sign the URL.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: job } = await supabase
    .from("formatting_jobs")
    .select("output_files, status")
    .eq("project_id", projectId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const path = job?.output_files?.[0];
  if (!path) return NextResponse.json({ error: "No completed export found for this project." }, { status: 404 });

  const service = createServiceClient();
  const { data: signed, error } = await service.storage.from("exports").createSignedUrl(path, 60);
  if (error || !signed) {
    return NextResponse.json({ error: error?.message || "Could not create a download link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
