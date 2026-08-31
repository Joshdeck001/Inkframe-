import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } from "docx";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Assembles the approved manuscript into a DOCX file and stores it in the
 * private `exports` bucket. EPUB/PDF aren't implemented yet — output_formats
 * only ever lists what was actually produced, never a format that doesn't
 * exist as a real file.
 */
export async function runFormattingDepartmentTick(supabase: SupabaseClient): Promise<{
  processed: boolean;
  detail: string;
}> {
  const { data: project, error: projectQueryError } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("status", "FORMATTING")
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (projectQueryError) throw new Error(`Could not query projects: ${projectQueryError.message}`);
  if (!project) return { processed: false, detail: "No projects awaiting formatting." };

  const [{ data: identity }, { data: chapters }] = await Promise.all([
    supabase.from("project_identity").select("*").eq("project_id", project.id).single(),
    supabase
      .from("chapters")
      .select("chapter_number, title, content")
      .eq("project_id", project.id)
      .order("chapter_number", { ascending: true }),
  ]);

  const { data: formattingJob, error: jobError } = await supabase
    .from("formatting_jobs")
    .insert({ project_id: project.id, output_formats: ["docx"], status: "processing" })
    .select()
    .single();
  if (jobError) throw new Error(jobError.message);

  try {
    const titleParagraphs = [
      new Paragraph({
        text: identity?.working_title || "Untitled Project",
        heading: HeadingLevel.TITLE,
      }),
      ...(identity?.subtitle ? [new Paragraph({ text: identity.subtitle, heading: HeadingLevel.HEADING_2 })] : []),
      ...(identity?.author_name ? [new Paragraph({ text: identity.author_name })] : []),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    const chapterParagraphs = (chapters ?? []).flatMap((chapter) => [
      new Paragraph({
        text: `Chapter ${chapter.chapter_number}: ${chapter.title}`,
        heading: HeadingLevel.HEADING_1,
      }),
      ...chapter.content
        .split(/\n{2,}/)
        .filter((p: string) => p.trim().length > 0)
        .map((p: string) => new Paragraph({ children: [new TextRun(p.trim())], spacing: { after: 200 } })),
      new Paragraph({ children: [new PageBreak()] }),
    ]);

    const doc = new Document({
      sections: [{ children: [...titleParagraphs, ...chapterParagraphs] }],
    });

    const buffer = await Packer.toBuffer(doc);
    const path = `${project.user_id}/${project.id}/manuscript.docx`;

    const { error: uploadError } = await supabase.storage.from("exports").upload(path, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (uploadError) throw new Error(uploadError.message);

    await supabase
      .from("formatting_jobs")
      .update({ status: "complete", output_files: [path] })
      .eq("id", formattingJob.id);

    await supabase.from("export_records").insert({
      project_id: project.id,
      export_type: "full_manuscript",
      file_ref: path,
    });

    await supabase.from("projects").update({ status: "READY_FOR_REVIEW" }).eq("id", project.id);

    return { processed: true, detail: `Project ${project.id}: manuscript.docx generated, moved to READY_FOR_REVIEW.` };
  } catch (e) {
    await supabase.from("formatting_jobs").update({ status: "failed" }).eq("id", formattingJob.id);
    throw e;
  }
}
