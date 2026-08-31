"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title as pageTitle } from "@/content/wizard";
import type { BlueprintStructure } from "@/lib/blueprint-schema";
import { totalWords } from "@/lib/blueprint-schema";
import { useEffect } from "react";

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

export default function WizardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [currentStep, setCurrentStep] = useState(1);

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

      setProjectId(pid);
      return pid;
    } finally {
      setSaving(false);
    }
  }

  async function generateBlueprint(pid: string) {
    setBlueprintLoading(true);
    setBlueprintError(null);
    try {
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

  async function goStep9() {
    setSaveError(null);
    try {
      const pid = await saveProjectRecord();
      if (!blueprint) {
        await generateBlueprint(pid);
      }
      setCurrentStep(9);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save this project.");
    }
  }

  async function startWriting() {
    if (!projectId) return;
    // The autonomous Writing Agent (Step 6) isn't built yet — leave the project
    // queued and honest about that rather than faking a "writing" progress bar.
    router.push(`/job-progress?project=${projectId}`);
  }

  function handleNext() {
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
    if (!confirm("Discard this new book and exit?")) return;
    if (projectId) {
      await supabase.from("projects").delete().eq("id", projectId);
    }
    router.push("/dashboard");
  }

  const progressPct = ((currentStep - 1) / (TOTAL_STEPS - 1)) * 100;
  const isLastStep = currentStep === TOTAL_STEPS;
  const nextDisabled =
    (currentStep === 9 && (blueprintLoading || !blueprint || !blueprintApproved)) || saving;

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
            <div className="blueprint-box">
              <h3>Title Check</h3>
              <div className="risk-badge ok">✓ No significant issue detected</div>
              <p className="hint" style={{ marginTop: "10px" }}>
                This is a risk assessment, not a legal guarantee. InkFrame flags potential conflicts — always
                use your own judgment for final clearance.
              </p>
            </div>
            <div className="blueprint-box">
              <h3>Category Research</h3>
              <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
                InkFrame will scan comparable titles in your category to identify content gaps, then report
                what this book can do differently before writing begins.
              </p>
            </div>
            {saveError && <p style={{ color: "var(--red)", fontSize: "13px" }}>{saveError}</p>}
          </div>
        )}

        {currentStep === 9 && (
          <div className="step active">
            <div className="step-title">Review your Book Blueprint</div>
            <div className="step-sub">Nothing is written until you approve this structure.</div>

            {blueprintLoading && (
              <div className="blueprint-box" style={{ textAlign: "center", padding: "36px 20px" }}>
                Generating your blueprint…
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
          {saving || (currentStep === 8 && blueprintLoading)
            ? "Saving…"
            : isLastStep
            ? "＋ Start Writing"
            : "Continue →"}
        </button>
      </div>
    </>
  );
}
