import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESPOND_TOOL: ToolSpec = {
  name: "respond_to_user",
  description:
    "Classify the author's message about this one book project and draft a short spoken-friendly reply, using only the real project facts given.",
  input_schema: {
    type: "object" as const,
    properties: {
      intent: {
        type: "string",
        enum: ["status_query", "pause_production", "resume_production", "revise_chapter", "general_question"],
      },
      chapter_number: {
        type: ["integer", "null"],
        description: "Only set for revise_chapter, when the author named a specific chapter number.",
      },
      reply: {
        type: "string",
        description: "1-4 natural sentences, safe to read aloud, using only the facts provided.",
      },
    },
    required: ["intent", "chapter_number", "reply"],
  },
};

type Intent = "status_query" | "pause_production" | "resume_production" | "revise_chapter" | "general_question";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: session } = await supabase
    .from("copilot_sessions")
    .select("id, production_paused")
    .eq("project_id", projectId)
    .maybeSingle();

  if (!session) return NextResponse.json({ messages: [], production_paused: false });

  const { data: messages } = await supabase
    .from("copilot_messages")
    .select("id, role, content, triggered_action, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ messages: messages ?? [], production_paused: session.production_paused });
}

export async function POST(request: Request) {
  const { project_id, message, action } = await request.json();
  if (!project_id || (!message && !action)) {
    return NextResponse.json({ error: "project_id and either message or action are required" }, { status: 400 });
  }
  if (action && action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: "action must be pause or resume" }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: project } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", project_id)
    .maybeSingle();
  if (!project) {
    // RLS silently returns no row for a project this user doesn't own — treat both the same.
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("copilot_sessions")
    .upsert({ user_id: user.id, project_id }, { onConflict: "project_id", ignoreDuplicates: false })
    .select("id, production_paused")
    .single();
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  // The Pause/Resume Production buttons bypass the LLM entirely — a reliable
  // direct DB write, not something that depends on the model classifying it
  // correctly. Independent of mute, which never touches this table.
  if (action) {
    const paused = action === "pause";
    await supabase.from("copilot_sessions").update({ production_paused: paused }).eq("id", session.id);
    const reply = paused
      ? "Production paused. I'll stop working on this book until you resume."
      : "Resuming production now.";
    await supabase.from("copilot_messages").insert([
      { session_id: session.id, role: "user", content: paused ? "[Pause Production]" : "[Resume Production]" },
      { session_id: session.id, role: "inkframe", content: reply, triggered_action: `${action}_production` },
    ]);
    return NextResponse.json({ reply, production_paused: paused, triggered_action: `${action}_production` });
  }

  await supabase.from("copilot_messages").insert({ session_id: session.id, role: "user", content: message });

  const [{ data: identity }, { data: chapters }, { data: scope }, { data: gate }, { data: complianceChecks }, { data: formattingJobs }] =
    await Promise.all([
      supabase.from("project_identity").select("working_title").eq("project_id", project_id).maybeSingle(),
      supabase.from("chapters").select("chapter_number, title, status").eq("project_id", project_id).order("chapter_number"),
      supabase.from("project_scope").select("target_word_count, words_written").eq("project_id", project_id).maybeSingle(),
      supabase.from("quality_gate").select("overall_readiness_score").eq("project_id", project_id).maybeSingle(),
      supabase.from("compliance_checks").select("status").eq("project_id", project_id),
      supabase.from("formatting_jobs").select("status").eq("project_id", project_id).order("created_at", { ascending: false }).limit(1),
    ]);

  const chapterList = chapters ?? [];
  const approvedCount = chapterList.filter((c) => c.status === "approved").length;
  const complianceSummary = (complianceChecks ?? []).reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});

  const facts = [
    `Project title: ${identity?.working_title || "Untitled Project"}`,
    `Current pipeline status: ${project.status}`,
    `Production currently ${session.production_paused ? "PAUSED by the author" : "running normally"}.`,
    chapterList.length > 0
      ? `Chapters: ${chapterList.length} total, ${approvedCount} approved. Per-chapter status: ${chapterList
          .map((c) => `#${c.chapter_number} "${c.title}" (${c.status})`)
          .join("; ")}`
      : "No chapters exist yet for this project.",
    scope?.target_word_count
      ? `Words written: ${scope.words_written ?? 0} of a ${scope.target_word_count} target.`
      : null,
    gate?.overall_readiness_score != null
      ? `Internal quality gate score: ${gate.overall_readiness_score}/100 (an internal assessment, not a guarantee).`
      : "Quality gate has not run yet.",
    Object.keys(complianceSummary).length > 0
      ? `Compliance checks: ${Object.entries(complianceSummary).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")}.`
      : "No compliance checks have run yet.",
    formattingJobs && formattingJobs.length > 0
      ? `Latest formatting job: ${formattingJobs[0].status}.`
      : "No formatting job has run yet.",
  ]
    .filter(Boolean)
    .join("\n");

  let parsed: { intent: Intent; chapter_number: number | null; reply: string };
  try {
    const generated = await generateStructured<{ intent: Intent; chapter_number: number | null; reply: string }>({
      system:
        "You are InkFrame's AI Copilot, speaking directly to the author about ONE specific book project. Below " +
        "are the real, current facts about this project from the database — use ONLY these facts, never invent " +
        "progress, numbers, or chapter content that isn't listed. If something isn't available yet, say so " +
        "plainly. Classify the author's message into exactly one intent: status_query (asking what's " +
        "happening/progress), pause_production (asking to pause/stop/hold work), resume_production (asking to " +
        "resume/continue/unpause), revise_chapter (asking to redo/fix/change a specific chapter — set " +
        "chapter_number if one was named, else null), or general_question (anything else). Write a short reply " +
        "(1-4 sentences, safe to read aloud). Never claim InkFrame submits anything to a publishing or " +
        "advertising platform — it only prepares content for the author to submit themselves.\n\n" +
        `Project facts:\n${facts}`,
      userContent: message,
      tool: RESPOND_TOOL,
      maxTokens: 500,
    });
    parsed = generated.output;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Copilot did not return structured output." },
      { status: 502 }
    );
  }

  let reply = parsed.reply;
  let triggeredAction: string | null = null;
  let productionPaused = session.production_paused;

  if (parsed.intent === "pause_production") {
    await supabase.from("copilot_sessions").update({ production_paused: true }).eq("id", session.id);
    productionPaused = true;
    triggeredAction = "pause_production";
  } else if (parsed.intent === "resume_production") {
    await supabase.from("copilot_sessions").update({ production_paused: false }).eq("id", session.id);
    productionPaused = false;
    triggeredAction = "resume_production";
  } else if (parsed.intent === "revise_chapter") {
    const target =
      parsed.chapter_number != null ? chapterList.find((c) => c.chapter_number === parsed.chapter_number) : null;
    if (!target) {
      reply = `I couldn't find that chapter on this project — ${
        chapterList.length > 0 ? `it has chapters ${chapterList[0].chapter_number} through ${chapterList[chapterList.length - 1].chapter_number}.` : "it has no chapters yet."
      }`;
    } else if (target.status !== "approved") {
      reply = `Chapter ${target.chapter_number} is still "${target.status}" — it hasn't finished its first pass yet, so there's nothing to send back for revision.`;
    } else if (project.status === "EXPORTED") {
      reply = `This book has already been exported, so I can't automatically reopen chapter ${target.chapter_number} for revision. You'd need to start a new revision pass manually.`;
    } else {
      await supabase.from("chapters").update({ status: "written" }).eq("project_id", project_id).eq("chapter_number", target.chapter_number);
      await supabase.from("projects").update({ status: "REVIEWING" }).eq("id", project_id);
      triggeredAction = `revise_chapter:${target.chapter_number}`;
      reply = `Sent chapter ${target.chapter_number} ("${target.title}") back through the Quality Loop for revision. It'll be picked up on the next background pass.`;
    }
  }

  await supabase.from("copilot_messages").insert({
    session_id: session.id,
    role: "inkframe",
    content: reply,
    triggered_action: triggeredAction,
  });

  return NextResponse.json({ reply, production_paused: productionPaused, triggered_action: triggeredAction });
}
