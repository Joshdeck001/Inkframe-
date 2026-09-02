"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/wizard";
import type { BlueprintStructure } from "@/lib/blueprint-schema";
import { totalWords } from "@/lib/blueprint-schema";

export const dynamic = "force-dynamic";

const TOTAL_STEPS = 10;
const STEP_LABELS = [
  "Book Type",
  "Book Identity",
  "Audience",
  "Book Size",
  "Writing Style",
  "Platform",
  "Images",
  "Research",
  "Book Blueprint",
  "Start Writing",
];

const BOOK_TYPES = [
  { value: "Fiction", icon: "📖", label: "Fiction" },
  { value: "Nonfiction", icon: "📘", label: "Nonfiction" },
  { value: "Biography", icon: "🧑", label: "Biography" },
  { value: "Memoir", icon: "✍️", label: "Memoir" },
  { value: "Self-help", icon: "💡", label: "Self-help" },
  { value: "Educational", icon: "🎓", label: "Educational" },
  { value: "Technical/Professional", icon: "⚙️", label: "Technical / Professional" },
  { value: "Children's", icon: "🧸", label: "Children's Book" },
  { value: "Serial Fiction", icon: "📱", label: "Serial Fiction" },
  { value: "Other", icon: "✦", label: "Other" },
];

function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`pill${selected ? " selected" : ""}`} onClick={onClick}>
      {children}
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * Everything the wizard needs to resume an in-progress project, fetched
 * together so the caller can wrap the whole batch in one timeout/try-catch
 * instead of leaving any single failed request able to hang the "Loading
 * your book…" screen forever (a real bug found on a slow mobile connection
 * — Promise.all rejecting with nothing catching it left resuming stuck true).
 */
async function loadResumeData(supabase: ReturnType<typeof createClient>, projectId: string) {
  const [
    { data: project },
    { data: identity },
    { data: audience },
    { data: scope },
    { data: style },
    { data: platform },
    { data: images },
    { data: riskChecks },
    { data: notes },
    { data: blueprints },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", projectId).single(),
    supabase.from("project_identity").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_audience").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_scope").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_style").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_platform").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("project_images").select("*").eq("project_id", projectId).maybeSingle(),
    supabase
      .from("title_risk_checks")
      .select("*")
      .eq("project_id", projectId)
      .order("checked_at", { ascending: false })
      .limit(1),
    supabase
      .from("research_notes")
      .select("*")
      .eq("project_id", projectId)
      .eq("research_type", "genre")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("book_blueprint")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1),
  ]);
  return { project, identity, audience, scope, style, platform, images, riskChecks, notes, blueprints };
}

function WizardBody() {
  const router = useRouter();
  const supabase = createClient();
  const searchParams = useSearchParams();
  const resumeProjectId = searchParams.get("project");

  const [currentStep, setCurrentStep] = useState(1);
  const [resuming, setResuming] = useState(!!resumeProjectId);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const [bookType, setBookType] = useState("");

  const [workingTitle, setWorkingTitle] = useState("");
  const [initialIdea, setInitialIdea] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [penName, setPenName] = useState("");
  const [language, setLanguage] = useState("English");
  const [targetMarketplace, setTargetMarketplace] = useState("");

  const [targetAudience, setTargetAudience] = useState("");
  const [readerLevel, setReaderLevel] = useState("");
  const [primaryReaderProblem, setPrimaryReaderProblem] = useState("");
  const [corePromise, setCorePromise] = useState("");
  const [purpose, setPurpose] = useState("");

  const [targetWordCount, setTargetWordCount] = useState(60000);
  const [estimatedChapterCount, setEstimatedChapterCount] = useState(12);
  const [desiredDepth, setDesiredDepth] = useState("");
  const [trimSize, setTrimSize] = useState("6x9");

  const [tone, setTone] = useState("");
  const [pov, setPov] = useState("");
  const [pacing, setPacing] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [referenceFileNames, setReferenceFileNames] = useState<string[]>([]);

  const [platformTarget, setPlatformTarget] = useState("");
  const [submissionGoal, setSubmissionGoal] = useState("");

  const [imageWorkflow, setImageWorkflow] = useState("");
  const [autoPlacement, setAutoPlacement] = useState("");

  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [titleRiskStatus, setTitleRiskStatus] = useState<string | null>(null);
  const [titleRiskNotes, setTitleRiskNotes] = useState<string | null>(null);
  const [categorySummary, setCategorySummary] = useState<string | null>(null);
  const [differentiationIdeas, setDifferentiationIdeas] = useState<string[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  const [blueprint, setBlueprint] = useState<BlueprintStructure | null>(null);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const [blueprintVersion, setBlueprintVersion] = useState(0);
  const [blueprintApproved, setBlueprintApproved] = useState(false);
  const [blueprintLoading, setBlueprintLoading] = useState(false);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [editingBlueprint, setEditingBlueprint] = useState(false);

  const isSerialPlatform = platformTarget === "GoodNovel" || platformTarget === "Meganovel";
  const showImageFollowup = imageWorkflow === "Generate Automatically" || imageWorkflow === "Mixed";

  useEffect(() => {
    document.title = pageTitle;
  }, []);

  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Resuming an in-progress book (from My Books' "Continue Setup") instead
  // of starting a blank wizard and losing everything already entered.
  // Loads every field the wizard itself would have saved, then jumps
  // straight to wherever that project actually left off: step 9 with its
  // existing draft blueprint loaded if one was already generated, or step 8
  // (re-running research only if it was never done) if it wasn't. Pulled
  // out of the effect (rather than an inline IIFE) so the "Try Again"
  // button on a failed load can re-run the exact same thing. Doesn't set
  // resuming/resumeError itself — the initial mount already starts with
  // resuming true, and the "Try Again" button sets both before calling this,
  // so this can run without any synchronous setState of its own.
  async function attemptResume(pid: string) {
    let loaded: Awaited<ReturnType<typeof loadResumeData>>;
    try {
      loaded = await withTimeout(
        loadResumeData(supabase, pid),
        20000,
        "This is taking too long to load — check your connection and try again."
      );
    } catch (e) {
      if (!unmountedRef.current) {
        setResumeError(e instanceof Error ? e.message : "Couldn't load this book. Try again.");
        setResuming(false);
      }
      return;
    }
    if (unmountedRef.current) return;

    const { project, identity, audience, scope, style, platform, images, riskChecks, notes, blueprints } = loaded;

    if (!project) {
      setResumeError("Couldn't find that book — it may have been deleted.");
      setResuming(false);
      return;
    }

    // Already past the wizard's part of the job — nothing left here to
    // resume, so send it to where its real progress actually lives.
    if (!["IDEA", "BLUEPRINT", "AWAITING_APPROVAL"].includes(project.status)) {
      router.replace(`/job-progress?project=${pid}`);
      return;
    }

    setProjectId(pid);
    setBookType(project.book_type || "");

      if (identity) {
        setWorkingTitle(identity.working_title || "");
        setSubtitle(identity.subtitle || "");
        setAuthorName(identity.author_name || "");
        setPenName(identity.pen_name || "");
        setSeriesName(identity.series_name || "");
        setLanguage(identity.language || "English");
        setTargetMarketplace(identity.target_marketplace || "");
        setInitialIdea(identity.initial_idea || "");
      }
      if (audience) {
        setTargetAudience(audience.target_audience || "");
        setReaderLevel(audience.reader_level || "");
        setPrimaryReaderProblem(audience.primary_reader_problem || "");
        setCorePromise(audience.core_promise || "");
        setPurpose(audience.purpose || "");
      }
      if (scope) {
        setTargetWordCount(scope.target_word_count || 60000);
        setEstimatedChapterCount(scope.estimated_chapter_count || 12);
        setDesiredDepth(scope.desired_depth || "");
        setTrimSize(scope.trim_size || "6x9");
      }
      if (style) {
        setTone(style.tone || "");
        setPov(style.pov || "");
        setPacing(style.pacing || "");
        setAdditionalInstructions(style.additional_instructions || "");
      }
      if (platform) {
        setPlatformTarget(platform.platform_target || "");
        setSubmissionGoal(platform.submission_goal || "");
      }
      if (images) {
        setImageWorkflow(images.image_workflow || "");
        setAutoPlacement(images.auto_placement_enabled ? "Yes" : "No");
      }

      const risk = riskChecks?.[0];
      if (risk) {
        setTitleRiskStatus(risk.status);
        setTitleRiskNotes(risk.notes);
      }
      const note = notes?.[0];
      if (note?.content) {
        const marker = "\n\nDifferentiation ideas:\n- ";
        const markerIndex = note.content.indexOf(marker);
        if (markerIndex === -1) {
          setCategorySummary(note.content);
        } else {
          setCategorySummary(note.content.slice(0, markerIndex));
          setDifferentiationIdeas(note.content.slice(markerIndex + marker.length).split("\n- "));
        }
      }

    // Landing here at all (rather than being redirected to job-progress
    // above) means the project's status already says it needs a blueprint
    // (re-)approval — reopen-blueprint sets that status explicitly when
    // pulling an already-writing project back in for restructuring, so an
    // existing blueprint is shown as the starting point to edit/regenerate
    // even if it was previously approved, rather than being ignored.
    const bp = blueprints?.[0];
    if (bp) {
      setBlueprint(bp.structure);
      setBlueprintId(bp.id);
      setBlueprintVersion(bp.version);
      setBlueprintApproved(false);
      setCurrentStep(9);
    } else {
      setCurrentStep(8);
      if (!risk) {
        await generateResearch(pid);
      }
    }

    setResuming(false);
  }

  useEffect(() => {
    if (!resumeProjectId) return;
    // setTimeout defers the call out of this synchronous effect body —
    // attemptResume eventually calls setState (after its first await), and
    // the lint rule can't otherwise tell that apart from a genuine
    // synchronous-setState-in-effect footgun.
    const timer = setTimeout(() => attemptResume(resumeProjectId), 0);
    return () => clearTimeout(timer);
    // Deliberately only re-runs if the project id in the URL itself changes
    // — generateResearch/router/supabase are stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeProjectId]);

  async function saveProjectRecord(): Promise<string> {
    if (projectId) return projectId;

    setSaving(true);
    setSaveError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const { data: project, error: projectError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, book_type: bookType || "Other", status: "BLUEPRINT" })
        .select()
        .single();
      if (projectError || !project) throw new Error(projectError?.message || "Could not create project.");

      const pid = project.id as string;

      const [identityRes, audienceRes, scopeRes, styleRes, platformRes, imagesRes] = await Promise.all([
        supabase.from("project_identity").insert({
          project_id: pid,
          working_title: workingTitle || null,
          subtitle: subtitle || null,
          author_name: authorName || null,
          pen_name: penName || null,
          series_name: seriesName || null,
          language: language || null,
          target_marketplace: targetMarketplace || null,
          initial_idea: initialIdea || null,
        }),
        supabase.from("project_audience").insert({
          project_id: pid,
          target_audience: targetAudience || null,
          reader_level: readerLevel || null,
          primary_reader_problem: primaryReaderProblem || null,
          core_promise: corePromise || null,
          purpose: purpose || null,
        }),
        supabase.from("project_scope").insert({
          project_id: pid,
          target_word_count: targetWordCount || null,
          estimated_chapter_count: estimatedChapterCount || null,
          desired_depth: desiredDepth || null,
        }),
        supabase.from("project_style").insert({
          project_id: pid,
          tone: tone || null,
          pov: pov || null,
          pacing: pacing || null,
          additional_instructions: additionalInstructions || null,
        }),
        supabase.from("project_platform").insert({
          project_id: pid,
          platform_target: platformTarget || null,
          submission_goal: isSerialPlatform ? submissionGoal || null : null,
        }),
        supabase.from("project_images").insert({
          project_id: pid,
          image_workflow: imageWorkflow || null,
          auto_placement_enabled: autoPlacement === "Yes",
        }),
      ]);

      const firstError = [identityRes, audienceRes, scopeRes, styleRes, platformRes, imagesRes].find(
        (r) => r.error
      )?.error;
      if (firstError) throw new Error(firstError.message);

      // Best-effort, kept out of the required inserts above — see the same
      // note in generateBlueprint(): a stale PostgREST schema cache on some
      // Supabase projects can reject writes to this newer column even
      // though it exists, and that must never be able to block creating the
      // project itself over a field the formatting engine already has a
      // safe default for.
      await supabase.from("project_scope").update({ trim_size: trimSize || null }).eq("project_id", pid);

      setProjectId(pid);
      return pid;
    } finally {
      setSaving(false);
    }
  }

  async function generateResearch(pid: string) {
    setResearchLoading(true);
    setResearchError(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Research failed.");
      setTitleRiskStatus(json.title_risk.status);
      setTitleRiskNotes(json.title_risk.notes);
      setCategorySummary(json.category_research.summary);
      setDifferentiationIdeas(json.category_research.differentiation_ideas ?? []);
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : "Research failed.");
    } finally {
      setResearchLoading(false);
    }
  }

  async function generateBlueprint(pid: string) {
    setBlueprintLoading(true);
    setBlueprintError(null);
    try {
      // /api/blueprint reads project_scope straight from the database, not
      // from this page's state — so a chapter count (or word count/depth)
      // changed on step 4 after this project already existed (e.g. editing
      // an already-approved book via "Restructure This Book") has to be
      // written back before regenerating, or the AI never sees the change.
      const { error: scopeError } = await supabase
        .from("project_scope")
        .update({
          target_word_count: targetWordCount || null,
          estimated_chapter_count: estimatedChapterCount || null,
          desired_depth: desiredDepth || null,
        })
        .eq("project_id", pid);
      if (scopeError) throw new Error(scopeError.message);

      // Kept separate and best-effort: trim_size lives on a newer column
      // (0013_book_formatting.sql) that a stale PostgREST schema cache can
      // reject with "Could not find the column in the schema cache" on some
      // Supabase projects even though it genuinely exists — bundling it into
      // the update above would fail the WHOLE request (including the
      // chapter-count sync that actually matters here) over a trim-size
      // write that's non-critical either way (the formatting engine already
      // falls back to a sensible default when trim_size is unset).
      await supabase.from("project_scope").update({ trim_size: trimSize || null }).eq("project_id", pid);

      const res = await fetch("/api/blueprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: pid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Blueprint generation failed.");
      setBlueprint(json.blueprint.structure);
      setBlueprintId(json.blueprint.id);
      setBlueprintVersion(json.blueprint.version);
      setBlueprintApproved(false);
    } catch (e) {
      setBlueprintError(e instanceof Error ? e.message : "Blueprint generation failed.");
    } finally {
      setBlueprintLoading(false);
    }
  }

  async function handleApproveBlueprint() {
    if (!blueprintId || !projectId) return;
    const { error: e1 } = await supabase
      .from("book_blueprint")
      .update({ approval_status: "approved", approved_at: new Date().toISOString() })
      .eq("id", blueprintId);
    const { error: e2 } = await supabase.from("projects").update({ status: "QUEUED" }).eq("id", projectId);
    if (!e1 && !e2) setBlueprintApproved(true);
    else setBlueprintError((e1 || e2)?.message || "Could not save approval.");
  }

  async function handleSaveEdit() {
    if (!blueprintId || !blueprint) return;
    const { error } = await supabase
      .from("book_blueprint")
      .update({ structure: blueprint, approval_status: "draft" })
      .eq("id", blueprintId);
    if (error) {
      setBlueprintError(error.message);
      return;
    }
    setBlueprintApproved(false);
    setEditingBlueprint(false);
  }

  function updateChapterField(
    partIndex: number,
    chapterIndex: number,
    field: "title" | "objective" | "word_allocation",
    value: string
  ) {
    setBlueprint((prev) => {
      if (!prev) return prev;
      const parts = prev.parts.map((part, pI) => {
        if (pI !== partIndex) return part;
        const chapters = part.chapters.map((chapter, cI) => {
          if (cI !== chapterIndex) return chapter;
          if (field === "word_allocation") {
            return { ...chapter, word_allocation: parseInt(value, 10) || 0 };
          }
          return { ...chapter, [field]: value };
        });
        return { ...part, chapters };
      });
      return { ...prev, parts };
    });
  }

  async function goStep8() {
    setSaveError(null);
    try {
      const pid = await saveProjectRecord();
      // Move to step 8 first, *then* kick off research — its own "Checking
      // your title…" box (rendered on step 8) is the loading feedback, so
      // the screen visibly advances instead of sitting on step 7 with only
      // a static "Saving…" button label for however long the AI call takes.
      setCurrentStep(8);
      if (!titleRiskStatus) {
        await generateResearch(pid);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save this project.");
    }
  }

  async function goStep9() {
    setSaveError(null);
    try {
      const pid = projectId ?? (await saveProjectRecord());
      // Same reasoning as goStep8: advance to step 9 before awaiting
      // generateBlueprint() so its "Generating your blueprint…" box shows
      // immediately — a large book's blueprint can genuinely take a minute
      // or two, and without this the button just looked frozen on step 8.
      setCurrentStep(9);
      if (!blueprint) {
        await generateBlueprint(pid);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save this project.");
    }
  }

  async function startWriting() {
    if (!projectId) return;
    // Both the Writing Agent (Step 6) and Quality Loop (Step 7) run on a cron
    // schedule server-side, not from this click — this just sends the user
    // to watch real progress land.
    router.push(`/job-progress?project=${projectId}`);
  }

  function handleNext() {
    if (currentStep === 7) {
      goStep8();
      return;
    }
    if (currentStep === 8) {
      goStep9();
      return;
    }
    if (currentStep === TOTAL_STEPS) {
      startWriting();
      return;
    }
    setCurrentStep((s) => Math.min(TOTAL_STEPS, s + 1));
  }

  async function handleClose() {
    // Resuming an already-started book (My Books' "Continue Setup") has real
    // data worth keeping even if it's left unfinished again — closing just
    // steps away, it never deletes. Only a brand-new session with nothing
    // saved yet worth keeping gets the discard-on-close behavior below.
    if (resumeProjectId) {
      router.push("/dashboard");
      return;
    }
    if (!confirm("Discard this new book and exit?")) return;
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
    router.push("/dashboard");
  }

  const progressPct = ((currentStep - 1) / (TOTAL_STEPS - 1)) * 100;
  const isLastStep = currentStep === TOTAL_STEPS;
  const nextDisabled =
    (currentStep === 9 && (blueprintLoading || !blueprint || !blueprintApproved)) ||
    (currentStep === 8 && researchLoading) ||
    saving;

  if (resumeError) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="wrap" style={{ textAlign: "center", padding: "80px 20px" }}>
          <div className="step-title">Couldn&apos;t load this book</div>
          <p className="step-sub">{resumeError}</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (!resumeProjectId) return;
                setResuming(true);
                setResumeError(null);
                attemptResume(resumeProjectId);
              }}
            >
              ↻ Try Again
            </button>
            <button className="btn btn-primary" onClick={() => router.push("/books")}>
              ← Back to My Books
            </button>
          </div>
        </div>
      </>
    );
  }

  if (resuming) {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="wrap" style={{ textAlign: "center", padding: "80px 20px" }}>
          <div className="step-title">Loading your book…</div>
          <div className="step-sub">Picking up right where you left off.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <header className="wizard-header">
        <div className="logo">
          <span className="ink">Ink</span>
          <span className="frame">Frame</span>
        </div>
        <button className="close-btn" onClick={handleClose}>
          ✕
        </button>
      </header>

      <div className="progress-wrap">
        <div className="progress-steps">
          <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={`step-dot${n < currentStep ? " done" : ""}${n === currentStep ? " active" : ""}`}
            >
              {n}
            </div>
          ))}
        </div>
        <div className="progress-label">
          Step {currentStep} of {TOTAL_STEPS} — {STEP_LABELS[currentStep - 1]}
        </div>
      </div>

      <div className="wizard-body">
        {currentStep === 1 && (
          <div className="step active">
            <div className="step-title">What are you creating?</div>
            <div className="step-sub">This shapes every question that follows.</div>
            <div className="option-grid">
              {BOOK_TYPES.map((t) => (
                <div
                  key={t.value}
                  className={`option-card${bookType === t.value ? " selected" : ""}`}
                  onClick={() => setBookType(t.value)}
                >
                  <div className="oi">{t.icon}</div>
                  <div className="ot">{t.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="step active">
            <div className="step-title">Book identity</div>
            <div className="step-sub">Don&apos;t have a title yet? Just describe the idea — InkFrame can suggest titles later.</div>
            <div className="field">
              <label>Working Title</label>
              <input
                type="text"
                placeholder="e.g. The Hidden Path (or leave blank)"
                value={workingTitle}
                onChange={(e) => setWorkingTitle(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Book Description / Initial Idea</label>
              <textarea
                placeholder="What's this book about?"
                value={initialIdea}
                onChange={(e) => setInitialIdea(e.target.value)}
              />
            </div>
            <div className="row-2">
              <div className="field">
                <label>Subtitle</label>
                <input
                  type="text"
                  placeholder="Optional for now"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Series Name</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={seriesName}
                  onChange={(e) => setSeriesName(e.target.value)}
                />
              </div>
            </div>
            <div className="row-2">
              <div className="field">
                <label>Author Name</label>
                <input
                  type="text"
                  placeholder="Your name"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Pen Name</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={penName}
                  onChange={(e) => setPenName(e.target.value)}
                />
              </div>
            </div>
            <div className="row-2">
              <div className="field">
                <label>Primary Language</label>
                <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} />
              </div>
              <div className="field">
                <label>Target Marketplace</label>
                <input
                  type="text"
                  placeholder="e.g. United States"
                  value={targetMarketplace}
                  onChange={(e) => setTargetMarketplace(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="step active">
            <div className="step-title">Who is this book for?</div>
            <div className="step-sub">This shapes tone, depth, and vocabulary throughout.</div>
            <div className="field">
              <label>Target Audience</label>
              <input
                type="text"
                placeholder="e.g. first-time entrepreneurs, ages 25-40"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
              />
            </div>
            <label>Reader Level</label>
            <div className="pill-row">
              {["Beginner", "Intermediate", "Advanced", "Professional"].map((v) => (
                <Pill key={v} selected={readerLevel === v} onClick={() => setReaderLevel(v)}>
                  {v}
                </Pill>
              ))}
            </div>
            <div className="field" style={{ marginTop: "18px" }}>
              <label>Primary Reader Problem</label>
              <textarea
                placeholder="What problem does this book solve for them?"
                value={primaryReaderProblem}
                onChange={(e) => setPrimaryReaderProblem(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Core Promise</label>
              <textarea
                placeholder="What should the reader know, feel, or be able to do after finishing?"
                value={corePromise}
                onChange={(e) => setCorePromise(e.target.value)}
              />
            </div>
            <label>Main Purpose</label>
            <div className="pill-row">
              {["Teach", "Inform", "Entertain", "Tell a story", "Solve a problem", "Guide", "Inspire"].map(
                (v) => (
                  <Pill key={v} selected={purpose === v} onClick={() => setPurpose(v)}>
                    {v === "Guide" ? "Guide through a process" : v}
                  </Pill>
                )
              )}
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="step active">
            <div className="step-title">How long should this book be?</div>
            <div className="step-sub">InkFrame allocates words by chapter importance — not forced to be equal.</div>
            <div className="row-2">
              <div className="field">
                <label>Target Word Count</label>
                <input
                  type="number"
                  value={targetWordCount}
                  onChange={(e) => setTargetWordCount(parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="field">
                <label>Approximate Chapters</label>
                <input
                  type="number"
                  value={estimatedChapterCount}
                  onChange={(e) => setEstimatedChapterCount(parseInt(e.target.value, 10) || 1)}
                />
              </div>
            </div>
            <label>Desired Depth</label>
            <div className="pill-row">
              {["Accessible", "Standard", "Detailed", "Expert"].map((v) => (
                <Pill key={v} selected={desiredDepth === v} onClick={() => setDesiredDepth(v)}>
                  {v}
                </Pill>
              ))}
            </div>
            <label style={{ marginTop: "16px", display: "block" }}>Trim Size (the exported manuscript&apos;s page size)</label>
            <div className="pill-row">
              {[
                { v: "6x9", l: "6 x 9 in — Novel / Standard" },
                { v: "5.5x8.5", l: "5.5 x 8.5 in — Compact" },
                { v: "5x8", l: "5 x 8 in — Pocket" },
                { v: "8.5x11", l: "8.5 x 11 in — Guide / Workbook" },
              ].map(({ v, l }) => (
                <Pill key={v} selected={trimSize === v} onClick={() => setTrimSize(v)}>
                  {l}
                </Pill>
              ))}
            </div>
            <div className="word-preview" style={{ marginTop: "20px" }}>
              <div>
                <div className="wp-val">{targetWordCount.toLocaleString()}</div>
                <div className="wp-lbl">Target Words</div>
              </div>
              <div>
                <div className="wp-val">{estimatedChapterCount}</div>
                <div className="wp-lbl">Chapters</div>
              </div>
              <div>
                <div className="wp-val">
                  ~{Math.round(targetWordCount / Math.max(1, estimatedChapterCount)).toLocaleString()}
                </div>
                <div className="wp-lbl">Avg Words/Chapter</div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="step active">
            <div className="step-title">Writing style</div>
            <div className="step-sub">Sets the voice InkFrame writes in throughout the manuscript.</div>
            <label>Tone</label>
            <div className="pill-row">
              {[
                "Conversational",
                "Professional",
                "Academic",
                "Warm",
                "Direct",
                "Story-driven",
                "Cinematic",
                "Inspirational",
              ].map((v) => (
                <Pill key={v} selected={tone === v} onClick={() => setTone(v)}>
                  {v}
                </Pill>
              ))}
            </div>
            <label style={{ marginTop: "18px" }}>Point of View</label>
            <div className="pill-row">
              {[
                { v: "First", l: "First Person" },
                { v: "Second", l: "Second Person" },
                { v: "Third", l: "Third Person" },
                { v: "Mixed", l: "Mixed" },
              ].map(({ v, l }) => (
                <Pill key={v} selected={pov === v} onClick={() => setPov(v)}>
                  {l}
                </Pill>
              ))}
            </div>
            <label style={{ marginTop: "18px" }}>Pacing</label>
            <div className="pill-row">
              {[
                { v: "Fast", l: "Fast" },
                { v: "Balanced", l: "Balanced" },
                { v: "Detailed", l: "Detailed" },
                { v: "Reflective", l: "Slow / Reflective" },
              ].map(({ v, l }) => (
                <Pill key={v} selected={pacing === v} onClick={() => setPacing(v)}>
                  {l}
                </Pill>
              ))}
            </div>
            <div className="field" style={{ marginTop: "20px" }}>
              <label>Additional Instructions</label>
              <textarea
                placeholder="Anything else InkFrame should know about how you want this written"
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Reference Material</label>
              <input
                type="file"
                multiple
                onChange={(e) =>
                  setReferenceFileNames(Array.from(e.target.files ?? []).map((f) => f.name))
                }
              />
              {referenceFileNames.length > 0 && (
                <p className="hint" style={{ marginTop: "8px", marginBottom: 0 }}>
                  Selected: {referenceFileNames.join(", ")} (uploading these comes online with the Style
                  Reference feature)
                </p>
              )}
            </div>
            <div className="hint">
              Upload only material you have the rights to use — InkFrame treats these as inputs, not source
              text to copy.
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="step active">
            <div className="step-title">Where are you publishing this?</div>
            <div className="step-sub">InkFrame loads that platform&apos;s current rules automatically.</div>
            <div className="platform-group">
              <h4>Book Publishing</h4>
              <div className="pill-row">
                {["Amazon KDP", "Kobo", "Apple Books", "Google Play Books"].map((v) => (
                  <Pill key={v} selected={platformTarget === v} onClick={() => setPlatformTarget(v)}>
                    {v}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="platform-group">
              <h4>Serial / Contract Fiction</h4>
              <div className="pill-row">
                {["GoodNovel", "Meganovel"].map((v) => (
                  <Pill key={v} selected={platformTarget === v} onClick={() => setPlatformTarget(v)}>
                    {v}
                  </Pill>
                ))}
              </div>
            </div>
            <div className="platform-group">
              <h4>Other</h4>
              <div className="pill-row">
                {[
                  { v: "Other", l: "Other" },
                  { v: "General/None", l: "General / No Specific Platform" },
                ].map(({ v, l }) => (
                  <Pill key={v} selected={platformTarget === v} onClick={() => setPlatformTarget(v)}>
                    {l}
                  </Pill>
                ))}
              </div>
            </div>
            {isSerialPlatform && (
              <div style={{ marginTop: "10px" }}>
                <label>What&apos;s your current goal?</label>
                <div className="pill-row">
                  {[
                    { v: "Initial Submission", l: "Create Initial Submission" },
                    { v: "Apply for Contract", l: "Apply for Contract" },
                    { v: "Continue Contracted Story", l: "Continue Contracted Story" },
                    { v: "Continue Existing Story", l: "Continue Existing Story" },
                  ].map(({ v, l }) => (
                    <Pill key={v} selected={submissionGoal === v} onClick={() => setSubmissionGoal(v)}>
                      {l}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 7 && (
          <div className="step active">
            <div className="step-title">Will your book contain images?</div>
            <div className="option-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
              {[
                { v: "No Images", icon: "🚫", l: "No images" },
                { v: "Generate Automatically", icon: "✨", l: "Generate automatically" },
                { v: "User Upload", icon: "⬆", l: "I'll upload my own" },
                { v: "Mixed", icon: "🔀", l: "Mix of both" },
              ].map(({ v, icon, l }) => (
                <div
                  key={v}
                  className={`option-card${imageWorkflow === v ? " selected" : ""}`}
                  onClick={() => setImageWorkflow(v)}
                >
                  <div className="oi">{icon}</div>
                  <div className="ot">{l}</div>
                </div>
              ))}
            </div>
            {showImageFollowup && (
              <div style={{ marginTop: "24px" }}>
                <label>Should InkFrame recommend where images are useful?</label>
                <div className="pill-row">
                  {[
                    { v: "Yes", l: "Yes — recommend placements, show me before export" },
                    { v: "No", l: "No — I'll decide manually" },
                  ].map(({ v, l }) => (
                    <Pill key={v} selected={autoPlacement === v} onClick={() => setAutoPlacement(v)}>
                      {l}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === 8 && (
          <div className="step active">
            <div className="step-title">Research &amp; risk check</div>
            <div className="step-sub">InkFrame checks your title and researches your topic before writing begins.</div>

            {researchLoading && (
              <div className="blueprint-box" style={{ textAlign: "center", padding: "30px 20px" }}>
                Checking your title and researching the category… this can take up to a minute — stay on this
                tab.
              </div>
            )}

            {researchError && (
              <div className="blueprint-box">
                <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "10px" }}>{researchError}</p>
                <div className="pill-row">
                  <div
                    className="pill"
                    style={{ borderColor: "var(--redGlow)" }}
                    onClick={() => projectId && generateResearch(projectId)}
                  >
                    ↻ Try Again
                  </div>
                </div>
              </div>
            )}

            {titleRiskStatus && !researchLoading && (
              <>
                <div className="blueprint-box">
                  <h3>Title Check</h3>
                  <div className={`risk-badge ${titleRiskStatus === "no_issue" ? "ok" : "warn"}`}>
                    {titleRiskStatus === "no_issue" ? "✓ No significant issue detected" : "⚠ " + titleRiskStatus.replace(/_/g, " ")}
                  </div>
                  <p className="hint" style={{ marginTop: "10px" }}>{titleRiskNotes}</p>
                  <p className="hint">
                    This is a risk assessment, not a legal guarantee. InkFrame flags potential conflicts — always
                    use your own judgment for final clearance.
                  </p>
                </div>
                <div className="blueprint-box">
                  <h3>Category Research</h3>
                  <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>{categorySummary}</p>
                  {differentiationIdeas.length > 0 && (
                    <ul style={{ marginTop: "10px", paddingLeft: "18px", fontSize: "13px", color: "var(--muted)", lineHeight: 1.7 }}>
                      {differentiationIdeas.map((idea, i) => (
                        <li key={i}>{idea}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {saveError && <p style={{ color: "var(--red)", fontSize: "13px" }}>{saveError}</p>}
          </div>
        )}

        {currentStep === 9 && (
          <div className="step active">
            <div className="step-title">Review your Book Blueprint</div>
            <div className="step-sub">
              Nothing is written until you approve this structure. To change the chapter count, target word
              count, or trim size, click Back to Step 4 (Book Size), update it there, then come back here and hit
              &quot;Regenerate&quot;.
            </div>

            {blueprintLoading && (
              <div className="blueprint-box" style={{ textAlign: "center", padding: "36px 20px" }}>
                Generating your blueprint… for a large book this can take a minute or two — stay on this tab,
                it&apos;s still working.
              </div>
            )}

            {blueprintError && (
              <div className="blueprint-box">
                <p style={{ color: "var(--red)", fontSize: "13px", marginBottom: "10px" }}>{blueprintError}</p>
                <div className="pill-row">
                  <div
                    className="pill"
                    style={{ borderColor: "var(--redGlow)" }}
                    onClick={() => projectId && generateBlueprint(projectId)}
                  >
                    ↻ Try Again
                  </div>
                </div>
              </div>
            )}

            {blueprint && !blueprintLoading && (
              <>
                <p className="hint" style={{ marginBottom: "14px" }}>
                  Version {blueprintVersion} · {totalWords(blueprint).toLocaleString()} words planned
                  {blueprintApproved ? " · ✓ Approved" : ""}
                </p>
                {blueprint.parts.map((part, pI) => (
                  <div className="blueprint-box" key={pI}>
                    <h3>{part.title}</h3>
                    {part.chapters.map((chapter, cI) => (
                      <div className="chapter-row" key={cI}>
                        {editingBlueprint ? (
                          <>
                            <span style={{ display: "flex", gap: "8px", flex: 1, alignItems: "center" }}>
                              <span className="cnum">{chapter.number}.</span>
                              <input
                                type="text"
                                value={chapter.title}
                                onChange={(e) => updateChapterField(pI, cI, "title", e.target.value)}
                                style={{
                                  flex: 1,
                                  background: "#0d1626",
                                  border: "1px solid var(--border)",
                                  borderRadius: "8px",
                                  padding: "6px 10px",
                                  color: "#fff",
                                  fontSize: "13px",
                                }}
                              />
                            </span>
                            <input
                              type="number"
                              value={chapter.word_allocation}
                              onChange={(e) => updateChapterField(pI, cI, "word_allocation", e.target.value)}
                              style={{
                                width: "90px",
                                background: "#0d1626",
                                border: "1px solid var(--border)",
                                borderRadius: "8px",
                                padding: "6px 8px",
                                color: "#fff",
                                fontSize: "12px",
                              }}
                            />
                          </>
                        ) : (
                          <>
                            <span>
                              <span className="cnum">{chapter.number}.</span> {chapter.title}
                            </span>
                            <span className="cwords">~{chapter.word_allocation.toLocaleString()} words</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {blueprintError && <p style={{ color: "var(--red)", fontSize: "12.5px" }}>{blueprintError}</p>}

                <div className="pill-row" style={{ marginTop: "16px" }}>
                  {editingBlueprint ? (
                    <div className="pill" style={{ borderColor: "var(--blueGlow)" }} onClick={handleSaveEdit}>
                      ✓ Save Changes
                    </div>
                  ) : (
                    <div
                      className="pill"
                      style={{ borderColor: "var(--blueGlow)" }}
                      onClick={() => setEditingBlueprint(true)}
                    >
                      ✎ Edit Blueprint
                    </div>
                  )}
                  <div
                    className="pill"
                    style={{ borderColor: "var(--redGlow)" }}
                    onClick={() => projectId && generateBlueprint(projectId)}
                  >
                    ↻ Regenerate
                  </div>
                  {!blueprintApproved && !editingBlueprint && (
                    <div
                      className="pill"
                      style={{ background: "var(--blue)", borderColor: "var(--blue)", color: "#fff" }}
                      onClick={handleApproveBlueprint}
                    >
                      ✓ Approve Blueprint
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {currentStep === 10 && (
          <div className="step active">
            <div className="step-title">Ready to start writing</div>
            <div className="step-sub">InkFrame will work in the background — you can close this and come back anytime.</div>
            <div className="blueprint-box" style={{ textAlign: "center", padding: "36px 20px" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>✦</div>
              <h3 style={{ marginBottom: "8px" }}>Everything is ready</h3>
              <p style={{ fontSize: "13px", color: "var(--muted)" }}>
                Blueprint approved and queued. InkFrame will research, write, and review each chapter
                automatically once the Writing Agent picks it up. You&apos;ll get a notification when it&apos;s
                ready.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="nav-row">
        <button
          className="btn btn-back"
          style={{ visibility: currentStep === 1 ? "hidden" : "visible" }}
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
        >
          ← Back
        </button>
        <button className="btn btn-next" onClick={handleNext} disabled={nextDisabled}>
          {saving || (currentStep === 8 && researchLoading)
            ? "Saving…"
            : isLastStep
            ? "＋ Start Writing"
            : "Continue →"}
        </button>
      </div>
    </>
  );
}

export default function WizardPage() {
  return (
    <Suspense fallback={null}>
      <WizardBody />
    </Suspense>
  );
}
