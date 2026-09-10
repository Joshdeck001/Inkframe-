import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleBookPassport } from "@/lib/book-passport";
import { runPreflight, suggestPrice, type FormatType } from "@/lib/kdp-preparation";
import { buildKdpPackageZip } from "@/lib/kdp-package";

type Stage = { key: string; label: string; status: "pending" | "passed" | "blocked" | "failed"; detail: string };

const STAGE_ORDER: { key: string; label: string }[] = [
  { key: "preflight", label: "Book Health & KDP Preflight" },
  { key: "package", label: "Build KDP Ready Package" },
  { key: "finalize", label: "Finalize" },
];

function initStages(): Stage[] {
  return STAGE_ORDER.map((s) => ({ key: s.key, label: s.label, status: "pending", detail: "" }));
}

/**
 * Background "Prepare for KDP" processor — one stage of one publishing_jobs
 * row per tick, same "one unit of work per call" shape as every other
 * department (see lib/writing-agent.ts, lib/audiobook-department.ts).
 * Deliberately reuses publishing_jobs (already the one row-per-project-
 * per-platform publishing record) rather than a second job table — see
 * migration 0018_publishing_jobs_background.sql.
 *
 * Never regenerates an asset that already exists (manuscript, ebook
 * cover, paperback full-cover PDF, metadata) — it only reads and
 * validates what the existing systems already produced, then assembles
 * the KDP Ready Package from those real files. It never calls out to any
 * KDP API, because none exists for draft creation — see the "KDP
 * integration" section of the root README for the research behind that.
 */
export async function runKdpPreparationDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: job, error: jobQueryError } = await supabase
    .from("publishing_jobs")
    .select("id, project_id, target_platform, requested_formats, stages, status")
    .in("status", ["queued", "running"])
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobQueryError) throw new Error(`Could not query publishing_jobs: ${jobQueryError.message}`);
  if (!job) return { processed: false, detail: "No KDP preparation jobs waiting." };

  if (job.status === "queued") {
    await supabase.from("publishing_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);
  }

  const stages: Stage[] = Array.isArray(job.stages) && job.stages.length > 0 ? (job.stages as Stage[]) : initStages();
  const currentIndex = stages.findIndex((s) => s.status !== "passed");
  if (currentIndex === -1) {
    // Every stage already passed but status never flipped — finalize defensively rather than loop forever.
    await supabase
      .from("publishing_jobs")
      .update({ status: "ready_for_review", prepared_at: new Date().toISOString() })
      .eq("id", job.id);
    return { processed: true, detail: `Job ${job.id}: all stages already complete, marked ready_for_review.` };
  }
  const stage = stages[currentIndex];

  const requestedFormats = (job.requested_formats ?? []) as FormatType[];

  try {
    if (stage.key === "preflight") {
      const [passport, { data: editions }] = await Promise.all([
        assembleBookPassport(supabase, job.project_id),
        supabase.from("format_editions").select("format_type, price").eq("project_id", job.project_id),
      ]);
      if (!passport) throw new Error("Project not found.");

      const prices: Record<FormatType, string> = { ebook: "", paperback: "", hardcover: "" };
      for (const e of editions ?? []) {
        const f = e.format_type as FormatType;
        if (e.price != null && (f === "ebook" || f === "paperback" || f === "hardcover")) prices[f] = String(e.price);
      }

      const preflight = runPreflight(passport, requestedFormats, prices);

      if (!preflight.canProceed) {
        stages[currentIndex] = {
          ...stage,
          status: "blocked",
          detail: preflight.bookBlockers.map((b) => b.label).join("; "),
        };
        await supabase
          .from("publishing_jobs")
          .update({
            status: "needs_attention",
            stages,
            blockers: preflight.bookBlockers,
            error: `Cannot prepare for KDP yet: ${preflight.bookBlockers.map((b) => b.label).join(", ")}.`,
          })
          .eq("id", job.id);
        await supabase.from("publishing_log").insert({
          project_id: job.project_id,
          event: `KDP preflight found ${preflight.bookBlockers.length} blocker(s) for ${job.target_platform}: ${preflight.bookBlockers.map((b) => b.label).join(", ")}.`,
        });
        return { processed: true, detail: `Job ${job.id}: preflight blocked (${preflight.bookBlockers.length} issue(s)).` };
      }

      stages[currentIndex] = { ...stage, status: "passed", detail: `Book Health ${preflight.readinessPct}%. All requested formats reviewed.` };
      await supabase.from("publishing_jobs").update({ stages, blockers: [] }).eq("id", job.id);
      await supabase.from("publishing_log").insert({
        project_id: job.project_id,
        event: `KDP preflight passed for ${job.target_platform} (${requestedFormats.join(", ") || "no formats selected"}).`,
      });
      return { processed: true, detail: `Job ${job.id}: preflight passed.` };
    }

    if (stage.key === "package") {
      const [passport, { data: editions }, { data: declarationsRow }, { data: project }] = await Promise.all([
        assembleBookPassport(supabase, job.project_id),
        supabase.from("format_editions").select("format_type, price").eq("project_id", job.project_id),
        supabase
          .from("publishing_declarations")
          .select("rights_basis, rights_confirmed, ai_disclosure_acknowledged")
          .eq("project_id", job.project_id)
          .maybeSingle(),
        supabase.from("projects").select("user_id").eq("id", job.project_id).single(),
      ]);
      if (!passport || !project) throw new Error("Project not found.");

      const prices: Record<FormatType, string> = { ebook: "", paperback: "", hardcover: "" };
      for (const e of editions ?? []) {
        const f = e.format_type as FormatType;
        if (e.price != null && (f === "ebook" || f === "paperback" || f === "hardcover")) prices[f] = String(e.price);
      }
      const declarations = {
        rightsBasis: declarationsRow?.rights_basis ?? null,
        rightsConfirmed: declarationsRow?.rights_confirmed ?? false,
        aiDisclosureAcknowledged: declarationsRow?.ai_disclosure_acknowledged ?? false,
      };

      const preflight = runPreflight(passport, requestedFormats, prices);
      const { buffer, included } = await buildKdpPackageZip(
        supabase,
        passport,
        project.user_id,
        prices,
        declarations,
        preflight,
        job.target_platform
      );

      const platformSlug = job.target_platform.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `${project.user_id}/${job.project_id}/kdp-package-${platformSlug}.zip`;
      const { error: uploadError } = await supabase.storage.from("exports").upload(path, buffer, {
        contentType: "application/zip",
        upsert: true,
      });
      if (uploadError) throw new Error(uploadError.message);
      await supabase.from("export_records").insert({ project_id: job.project_id, export_type: "initial_submission", file_ref: path });

      const { data: meta } = await supabase
        .from("metadata_department")
        .select("description_long, keywords, categories")
        .eq("project_id", job.project_id)
        .maybeSingle();
      const preparedFields = {
        title: passport.identity?.workingTitle || "Untitled Project",
        description: meta?.description_long || "No description generated yet.",
        keywords: (meta?.keywords ?? []).join(", ") || "No keywords generated yet.",
        category: meta?.categories?.[0] || "Not yet categorized",
        price: prices.ebook.trim() ? prices.ebook : suggestPrice(passport.scope?.wordsWritten ?? 0),
      };

      stages[currentIndex] = { ...stage, status: "passed", detail: `${included.length} file(s) packaged.` };
      await supabase
        .from("publishing_jobs")
        .update({ stages, package_ref: path, prepared_fields: preparedFields, readiness_snapshot: preflight })
        .eq("id", job.id);
      await supabase.from("publishing_log").insert({
        project_id: job.project_id,
        event: `KDP Ready Package prepared for ${job.target_platform} (${included.length} file(s)).`,
      });
      return { processed: true, detail: `Job ${job.id}: package built (${included.length} files).` };
    }

    // finalize
    stages[currentIndex] = { ...stage, status: "passed", detail: "Ready for your review." };
    await supabase
      .from("publishing_jobs")
      .update({ status: "ready_for_review", stages, prepared_at: new Date().toISOString(), error: null })
      .eq("id", job.id);
    await supabase.from("publishing_log").insert({
      project_id: job.project_id,
      event: `KDP preparation complete for ${job.target_platform} — ready for your review.`,
    });
    return { processed: true, detail: `Job ${job.id}: preparation complete, ready for review.` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    stages[currentIndex] = { ...stage, status: "failed", detail: message };
    await supabase.from("publishing_jobs").update({ status: "needs_attention", stages, error: message }).eq("id", job.id);
    await supabase.from("publishing_log").insert({
      project_id: job.project_id,
      event: `KDP preparation failed at "${stage.label}" for ${job.target_platform}: ${message}`,
    });
    return { processed: true, detail: `Job ${job.id}: stage "${stage.key}" failed — ${message}` };
  }
}
