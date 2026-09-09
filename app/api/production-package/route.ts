import { NextResponse } from "next/server";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { assembleBookPassport } from "@/lib/book-passport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bundles everything a user would otherwise have to download one file at a
 * time — manuscript (DOCX/EPUB), cover, metadata, and the Book Passport
 * itself as project.json — into one downloadable zip they can take
 * anywhere. Assembles real, already-generated outputs only: if formatting
 * hasn't completed yet, this returns a clear error instead of a package
 * with missing/fake contents. Never a "publish" action — this is exactly
 * the "prepare, don't submit" boundary the rest of the app already draws
 * at /publish.
 */
export const GET = withJsonErrors(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project");
  if (!projectId) return NextResponse.json({ error: "project is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const passport = await assembleBookPassport(supabase, projectId);
  if (!passport) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: formattingJob } = await supabase
    .from("formatting_jobs")
    .select("output_files, status")
    .eq("project_id", projectId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const manuscriptPaths = formattingJob?.output_files ?? [];
  if (manuscriptPaths.length === 0) {
    return NextResponse.json(
      { error: "Manuscript formatting isn't complete yet — nothing to package. Finish formatting first." },
      { status: 400 }
    );
  }

  const { data: metadataRow } = await supabase
    .from("metadata_department")
    .select("description_long, description_short, keywords, categories, bisac_codes")
    .eq("project_id", projectId)
    .maybeSingle();

  const zip = new JSZip();
  const manuscriptFolder = zip.folder("manuscript")!;
  const included: string[] = [];

  const service = createServiceClient();
  for (const path of manuscriptPaths) {
    const { data: blob, error } = await service.storage.from("exports").download(path);
    if (error || !blob) continue; // skip a single missing file rather than fail the whole package
    const ext = path.split(".").pop() || "bin";
    const filename = `manuscript.${ext}`;
    manuscriptFolder.file(filename, await blob.arrayBuffer());
    included.push(`manuscript/${filename}`);
  }

  if (passport.cover.finalCoverRef) {
    try {
      const res = await fetch(passport.cover.finalCoverRef);
      if (res.ok) {
        const ext = passport.cover.finalCoverRef.split(".").pop()?.split("?")[0] || "jpg";
        const filename = `cover.${ext}`;
        zip.folder("covers")!.file(filename, await res.arrayBuffer());
        included.push(`covers/${filename}`);
      }
    } catch {
      // Cover fetch failing shouldn't block the rest of the package — it's just left out, never faked.
    }
  }

  const metadataFolder = zip.folder("metadata")!;
  if (metadataRow) {
    metadataFolder.file(
      "metadata.json",
      JSON.stringify(
        {
          title: passport.identity?.workingTitle ?? null,
          subtitle: passport.identity?.subtitle ?? null,
          author: passport.identity?.authorName ?? null,
          pen_name: passport.identity?.penName ?? null,
          series_name: passport.identity?.seriesName ?? null,
          series_number: passport.identity?.seriesNumber ?? null,
          keywords: metadataRow.keywords,
          categories: metadataRow.categories,
          bisac_codes: metadataRow.bisac_codes,
        },
        null,
        2
      )
    );
    metadataFolder.file("description.txt", metadataRow.description_long || metadataRow.description_short || "");
    included.push("metadata/metadata.json", "metadata/description.txt");
  }

  const projectFolder = zip.folder("project")!;
  projectFolder.file("project.json", JSON.stringify(passport, null, 2));
  included.push("project/project.json");

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        inkframe_project_id: projectId,
        title: passport.identity?.workingTitle ?? null,
        included_files: included,
        note: "Prepared by InkFrame for the author to use elsewhere. This package was not submitted anywhere — InkFrame never publishes automatically.",
      },
      null,
      2
    )
  );

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const path = `${user.id}/${projectId}/production-package.zip`;

  const { error: uploadError } = await service.storage.from("exports").upload(path, buffer, {
    contentType: "application/zip",
    upsert: true,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  // Same private-bucket + short-lived-signed-URL pattern as /api/export-download — never a public link.
  const { data: signed, error: signError } = await service.storage.from("exports").createSignedUrl(path, 60);
  if (signError || !signed) {
    return NextResponse.json({ error: signError?.message || "Could not create a download link." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
});
