"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title } from "@/content/dashboard";
import { copilotCss } from "@/content/dashboard-copilot.css";
import { STAGE_ORDER, type Stage } from "@/lib/research-department";
import type { ResearchReportSections } from "@/lib/research-report";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  status: string;
  updated_at: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
  project_scope: { words_written: number | null; target_word_count: number | null } | null;
  cover_department: {
    final_cover_ref: string | null;
    concepts: { image_ref: string | null; status: string }[] | null;
  } | null;
};

type SuggestionSession = { id: string; topic: string; mode: string; stages: Stage[]; status: string; error: string | null };
type SavedReportLike = { overall_assessment: string; confidence_level: string; evidence_summary: string; sections: ResearchReportSections };
const SUGGESTION_MODE_LABEL: Record<string, string> = {
  book_opportunity: "Book Opportunity",
  keyword_research: "Keyword Research",
  competition_analysis: "Competitor Research",
  market_research: "Market Research",
  topic_research: "Topic Research",
  series_research: "Series/Author Research",
  metadata_research: "Metadata Research",
  trend_research: "Trend Research",
  full_publishing_research: "Full Publishing Research",
};

/** The chosen cover if one was picked, else the first real generated concept — same fallback the Formatting Department itself uses when it embeds a cover. */
function coverThumbUrl(p: ProjectRow): string | null {
  const cover = p.cover_department;
  if (!cover) return null;
  if (cover.final_cover_ref) return cover.final_cover_ref;
  return cover.concepts?.find((c) => c.status === "generated" && c.image_ref)?.image_ref ?? null;
}

const SUGGESTION_SECTION_ORDER: (keyof ResearchReportSections)[] = ["executive_summary", "opportunities", "recommended_angle", "next_actions"];
const SUGGESTION_SECTION_LABEL: Record<string, string> = {
  executive_summary: "Executive Summary",
  opportunities: "Opportunities",
  recommended_angle: "Recommended Angle",
  next_actions: "Next Actions",
};

/**
 * The Suggestion Bar's result panel — a status checklist while the
 * session's real stages advance, then a teaser of the real generated
 * report (never a duplicate of Research's own full report view, which
 * "Open in Research" links straight into). See lib/research-department.ts
 * for the same stage list every other research session already uses.
 */
function SuggestionBarResults({
  session,
  report,
  error,
  onDismiss,
  onOpenInResearch,
  onFollowUp,
}: {
  session: SuggestionSession;
  report: SavedReportLike | null;
  error: string | null;
  onDismiss: () => void;
  onOpenInResearch: () => void;
  onFollowUp: (text: string) => void;
}) {
  const [followUpText, setFollowUpText] = useState("");
  const failed = session.status === "needs_attention" || session.status === "failed";

  return (
    <div className="panel" style={{ marginBottom: "20px" }}>
      <div className="panel-head">
        <h3>🔎 {session.topic}</h3>
        <span className="view-all" style={{ cursor: "pointer" }} onClick={onDismiss}>✕ Dismiss</span>
      </div>
      <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "14px" }}>
        {SUGGESTION_MODE_LABEL[session.mode] ?? session.mode} · reuses the same research pipeline as Research → New Research
      </div>

      {error && <p style={{ color: "var(--redGlow)", fontSize: "13px", marginBottom: "12px" }}>{error}</p>}

      {!report && !failed && (
        <div style={{ marginBottom: "14px" }}>
          {STAGE_ORDER.map((s) => {
            const found = session.stages.find((st) => st.key === s.key);
            const status = found?.status ?? "pending";
            const icon = status === "passed" ? "✓" : status === "failed" ? "✕" : status === "blocked" ? "⏸" : "…";
            return (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: "12.5px", color: status === "passed" ? "#5fe3b8" : "var(--muted)" }}>
                <span>{s.label}</span>
                <span>{icon}</span>
              </div>
            );
          })}
        </div>
      )}

      {failed && (
        <p style={{ fontSize: "13px", color: "var(--redGlow)", marginBottom: "12px" }}>
          Research hit a real error and stopped — {session.error || "see the session in Research for details"}.
        </p>
      )}

      {report && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px", fontSize: "12px", color: "var(--muted)" }}>
            <span>Assessment: {report.overall_assessment.replace(/_/g, " ")}</span>
            <span>· Confidence: {report.confidence_level.replace(/_/g, " ")}</span>
          </div>
          {SUGGESTION_SECTION_ORDER.map((key) => (
            <div key={key} style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>{SUGGESTION_SECTION_LABEL[key]}</div>
              <p style={{ fontSize: "13px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{report.sections[key]}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: report ? "14px" : "0" }}>
        <button className="btn-primary" onClick={onOpenInResearch}>
          Open Full Report in Research
        </button>
      </div>

      {report && (
        <div style={{ marginTop: "14px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
          <div style={{ fontSize: "12.5px", marginBottom: "8px", color: "var(--muted)" }}>Ask a follow-up — added as a note, then opens in Research to continue:</div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              value={followUpText}
              onChange={(e) => setFollowUpText(e.target.value)}
              placeholder="e.g. Now focus on seniors…"
              style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", color: "var(--ink)", fontSize: "13px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && followUpText.trim()) onFollowUp(followUpText.trim());
              }}
            />
            <button
              className="open-btn"
              style={{ width: "auto", padding: "8px 14px" }}
              onClick={() => followUpText.trim() && onFollowUp(followUpText.trim())}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  IDEA: "Draft",
  BLUEPRINT: "Blueprint",
  AWAITING_APPROVAL: "Awaiting Approval",
  QUEUED: "Queued",
  WRITING: "Writing",
  RESEARCHING: "Researching",
  REVIEWING: "Reviewing",
  REVISING: "Revising",
  FORMATTING: "Formatting",
  GENERATING_COVER: "Generating Cover",
  GENERATING_IMAGES: "Generating Images",
  GENERATING_METADATA: "Generating Metadata",
  COMPLIANCE_CHECK: "Compliance Check",
  READY_FOR_REVIEW: "Ready for Review",
  USER_APPROVED: "Approved",
  READY_FOR_EXPORT: "Ready for Export",
  EXPORTED: "Completed",
  AWAITING_CONTRACT_DECISION: "Awaiting Contract",
  CONTRACT_RECEIVED: "Contract Received",
  CONTRACT_NOT_ACCEPTED: "Contract Not Accepted",
  REVISION_REQUESTED: "Revision Requested",
};

function tagClass(status: string): string {
  if (status === "EXPORTED") return "completed";
  if (status === "FORMATTING") return "formatting";
  if (status === "IDEA") return "draft";
  return "progress";
}

function pctFor(p: ProjectRow): number {
  if (p.status === "EXPORTED") return 100;
  const target = p.project_scope?.target_word_count;
  const written = p.project_scope?.words_written ?? 0;
  if (!target) return p.status === "IDEA" ? 2 : 10;
  return Math.min(100, Math.round((written / target) * 100));
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotStatus, setCopilotStatus] = useState<"listening" | "muted" | "thinking" | "speaking">(
    "listening"
  );
  const [copilotMuted, setCopilotMuted] = useState(false);
  const [productionPaused, setProductionPaused] = useState(false);
  const [copilotSupported] = useState(() => {
    if (typeof window === "undefined") return true;
    const ctor =
      (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    return !!ctor && "speechSynthesis" in window;
  });
  const [transcript, setTranscript] = useState<
    { who: "user" | "inkframe"; text: string; suggestedAction?: { label: string; route: string } | null }[]
  >([{ who: "inkframe", text: "How can I help with this book?" }]);

  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [exportCount, setExportCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [tasks, setTasks] = useState<{ projectId: string; title: string; issue: string; route: string }[]>([]);
  const [recentActivity, setRecentActivity] = useState<{ title: string; event: string; time: string }[]>([]);
  const [publishingJobs, setPublishingJobs] = useState<
    { projectId: string; title: string; targetPlatform: string; status: string; stagesDone: number; stagesTotal: number }[]
  >([]);
  const [adminMessages, setAdminMessages] = useState<{ id: string; body: string }[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [suggestionSession, setSuggestionSession] = useState<SuggestionSession | null>(null);
  const [suggestionReport, setSuggestionReport] = useState<SavedReportLike | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    document.title = title;
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const name =
        (user.user_metadata?.full_name as string | undefined)?.trim() ||
        user.email?.split("@")[0] ||
        "there";
      if (!cancelled) {
        setDisplayName(name);
        setAvatarUrl((user.user_metadata?.avatar_url as string | undefined) ?? null);
      }

      const { data: projectRows } = await supabase
        .from("projects")
        .select(
          "id, status, updated_at, project_identity(working_title, subtitle), project_scope(words_written, target_word_count), cover_department(final_cover_ref, concepts)"
        )
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (!cancelled) {
        const rows = (projectRows ?? []) as unknown as ProjectRow[];
        setProjects(rows);
        setCompletedCount(rows.filter((p) => p.status === "EXPORTED").length);
      }

      const { count } = await supabase
        .from("export_records")
        .select("id", { count: "exact", head: true })
        .in(
          "project_id",
          ((projectRows ?? []) as unknown as ProjectRow[]).map((p) => p.id)
        );
      if (!cancelled) setExportCount(count ?? 0);

      // Tasks + Recent Activity — reuse the project list already fetched
      // above (no extra project query) and the existing quality_gate/
      // publishing_log tables (no new schema). quality_gate's own boolean
      // columns are cheap enough to check directly here rather than
      // running the full Book Passport assembly for every project just to
      // show one badge per book.
      const allIds = ((projectRows ?? []) as unknown as ProjectRow[]).map((p) => p.id);
      const unfinishedProjects = ((projectRows ?? []) as unknown as ProjectRow[]).filter((p) => p.status !== "EXPORTED");
      const titleById = new Map(unfinishedProjects.map((p) => [p.id, p.project_identity?.working_title || "Untitled Project"]));

      if (unfinishedProjects.length > 0) {
        const { data: gates } = await supabase
          .from("quality_gate")
          .select("project_id, metadata_check, formatting_check, cover_check, overall_readiness_score")
          .in("project_id", unfinishedProjects.map((p) => p.id));
        if (!cancelled && gates) {
          const found: { projectId: string; title: string; issue: string; route: string }[] = [];
          for (const g of gates) {
            const title = titleById.get(g.project_id);
            if (!title) continue;
            if (!g.metadata_check) found.push({ projectId: g.project_id, title, issue: "metadata incomplete", route: `/metadata?project=${g.project_id}` });
            else if (!g.formatting_check) found.push({ projectId: g.project_id, title, issue: "formatting incomplete", route: `/formatter?project=${g.project_id}` });
            else if (!g.cover_check) found.push({ projectId: g.project_id, title, issue: "cover missing", route: `/cover?project=${g.project_id}` });
          }
          setTasks(found.slice(0, 5));
        }
      }

      if (allIds.length > 0) {
        const { data: log } = await supabase
          .from("publishing_log")
          .select("event, occurred_at, project_id")
          .in("project_id", allIds)
          .order("occurred_at", { ascending: false })
          .limit(5);
        if (!cancelled && log) {
          const allTitleById = new Map(
            ((projectRows ?? []) as unknown as ProjectRow[]).map((p) => [p.id, p.project_identity?.working_title || "Untitled Project"])
          );
          setRecentActivity(
            log.map((r) => ({ title: allTitleById.get(r.project_id) ?? "Untitled Project", event: r.event, time: relativeTime(r.occurred_at) }))
          );
        }
      }

      // Publishing Jobs — background KDP preparation across every book at
      // once (spec: multiple books, one queue), reading the same
      // publishing_jobs rows /publish itself drives. Only the states worth
      // a user's attention: actively running, blocked, or freshly ready
      // (a job already marked user_marked_published has nothing left to
      // show here).
      if (allIds.length > 0) {
        const { data: jobs } = await supabase
          .from("publishing_jobs")
          .select("project_id, target_platform, status, stages")
          .in("project_id", allIds)
          .in("status", ["queued", "running", "needs_attention", "ready_for_review"]);
        if (!cancelled && jobs) {
          const allTitleById2 = new Map(
            ((projectRows ?? []) as unknown as ProjectRow[]).map((p) => [p.id, p.project_identity?.working_title || "Untitled Project"])
          );
          setPublishingJobs(
            jobs.map((j) => {
              const stages = (j.stages as { status: string }[] | null) ?? [];
              return {
                projectId: j.project_id,
                title: allTitleById2.get(j.project_id) ?? "Untitled Project",
                targetPlatform: j.target_platform,
                status: j.status,
                stagesDone: stages.filter((s) => s.status === "passed").length,
                stagesTotal: stages.length || 3,
              };
            })
          );
        }
      }

      const [{ data: messages }, { data: reads }] = await Promise.all([
        supabase
          .from("admin_messages")
          .select("id, body, created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("admin_message_reads").select("message_id"),
      ]);
      if (!cancelled) {
        const readIds = new Set((reads ?? []).map((r) => r.message_id));
        setAdminMessages((messages ?? []).filter((m) => !readIds.has(m.id)).map((m) => ({ id: m.id, body: m.body })));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function dismissAdminMessage(id: string) {
    setAdminMessages((msgs) => msgs.filter((m) => m.id !== id));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("admin_message_reads").insert({ message_id: id, user_id: user.id });
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
    router.refresh();
  }

  function createNewBook() {
    router.push("/wizard");
  }

  // job-progress is the one page that actually has working download
  // buttons once a book is ready — /publish is just a checklist with no
  // download link of its own, so routing a finished book there was a dead
  // end. Setup-stage books still need the wizard, since job-progress has
  // nothing to show for a project with no approved blueprint yet.
  function openProject(id: string, status: string) {
    if (["IDEA", "BLUEPRINT", "AWAITING_APPROVAL"].includes(status)) {
      router.push(`/wizard?project=${id}`);
    } else {
      router.push(`/job-progress?project=${id}`);
    }
  }

  // Suggestion Bar (see "Suggestion Bar" in README.md): the existing "Search your books"
  // box doubles as a natural-language research entry point. Typing still filters
  // visibleProjects live, unchanged; pressing Enter on a longer query additionally asks
  // the server whether it's a real research question — most short phrases (a book title)
  // come back `handled: false` and nothing else happens, since the local filter already
  // shows the match. Reuses the exact same research_sessions pipeline /research's "New
  // Research" already uses; this is not a second research engine.
  async function submitSuggestionQuery() {
    const q = searchQuery.trim();
    if (q.length < 4 || suggestionLoading) return;
    setSuggestionLoading(true);
    setSuggestionError(null);
    setSuggestionReport(null);
    // The server route now only does one fast AI classification call plus an insert
    // before responding (see app/api/suggestion-bar/query/route.ts) — the real research
    // work runs in the background after that. This client-side abort is a second,
    // independent safety net so "Thinking…" can never hang indefinitely even if the
    // network stalls or the server takes unexpectedly long: the request is cancelled
    // and a real error shown instead of leaving the UI stuck.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch("/api/suggestion-bar/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not process that request.");
      if (!json.handled) {
        setSuggestionSession(null);
        return;
      }
      setSuggestionSession({ id: json.session_id, topic: json.topic, mode: json.mode, stages: [], status: "running", error: null });
    } catch (e) {
      const message = e instanceof Error && e.name === "AbortError" ? "That took too long to respond — try again." : e instanceof Error ? e.message : "Could not process that request.";
      setSuggestionError(message);
    } finally {
      clearTimeout(timeout);
      setSuggestionLoading(false);
    }
  }

  async function addSuggestionFollowUp(sessionId: string, text: string) {
    if (!text.trim()) return;
    const { error } = await supabase.from("research_notes").insert({ session_id: sessionId, research_type: "user_note", content: text.trim(), source_type: "user_provided" });
    if (error) {
      setSuggestionError(`Could not save that note: ${error.message}`);
      return;
    }
    router.push(`/research?session=${sessionId}`);
  }

  useEffect(() => {
    if (!suggestionSession || suggestionSession.status === "completed" || suggestionSession.status === "needs_attention" || suggestionSession.status === "failed") return;
    let cancelled = false;
    const interval = setInterval(async () => {
      const { data } = await supabase.from("research_sessions").select("status, stages, error").eq("id", suggestionSession.id).maybeSingle();
      if (!data || cancelled) return;
      setSuggestionSession((s) => (s ? { ...s, status: data.status, stages: (data.stages as Stage[]) ?? [], error: data.error } : s));
      if (data.status === "completed") {
        const { data: report } = await supabase
          .from("research_reports")
          .select("overall_assessment, confidence_level, evidence_summary, sections")
          .eq("session_id", suggestionSession.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && report) setSuggestionReport(report as SavedReportLike);
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionSession?.id, suggestionSession?.status]);

  const active = projects?.find((p) => p.status !== "EXPORTED") ?? null;

  const visibleProjects = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;
    return (projects ?? []).filter((p) => {
      const title = p.project_identity?.working_title ?? "";
      const subtitle = p.project_identity?.subtitle ?? "";
      return title.toLowerCase().includes(q) || subtitle.toLowerCase().includes(q);
    });
  })();

  useEffect(() => {
    if (!copilotOpen || !active) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/copilot/message?project_id=${active.id}`);
      if (!res.ok || cancelled) return;
      const json = await res.json();
      if (cancelled) return;
      setProductionPaused(!!json.production_paused);
      if (json.messages?.length > 0) {
        setTranscript(
          json.messages.map((m: { role: "user" | "inkframe"; content: string }) => ({
            who: m.role === "inkframe" ? "inkframe" : "user",
            text: m.content,
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [copilotOpen, active]);

  async function sendCopilotMessage(text: string) {
    if (!active) {
      alert("Create a book first — the Copilot needs a project to talk about.");
      return;
    }
    setTranscript((t) => [...t, { who: "user", text }]);
    setCopilotStatus("thinking");
    try {
      const res = await fetch("/api/copilot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: active.id, message: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Copilot request failed.");
      setProductionPaused(!!json.production_paused);
      setTranscript((t) => [...t, { who: "inkframe", text: json.reply, suggestedAction: json.suggested_action ?? null }]);
      speak(json.reply);
    } catch (e) {
      const errText = e instanceof Error ? e.message : "Sorry — I couldn't reach the Copilot just now.";
      setTranscript((t) => [...t, { who: "inkframe", text: errText }]);
      setCopilotStatus(copilotMuted ? "muted" : "listening");
    }
  }

  function speak(text: string) {
    if (copilotMuted || !("speechSynthesis" in window)) {
      setCopilotStatus(copilotMuted ? "muted" : "listening");
      return;
    }
    setCopilotStatus("speaking");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setCopilotStatus(copilotMuted ? "muted" : "listening");
    utterance.onerror = () => setCopilotStatus(copilotMuted ? "muted" : "listening");
    window.speechSynthesis.speak(utterance);
  }

  function cpToggleListen() {
    if (copilotMuted) {
      alert("InkFrame is muted. Unmute first to talk.");
      return;
    }
    if (!active) {
      alert("Create a book first — the Copilot needs a project to talk about.");
      return;
    }
    if (!copilotSupported) {
      const text = window.prompt("Voice isn't supported in this browser. Type your message to InkFrame:");
      if (text && text.trim()) sendCopilotMessage(text.trim());
      return;
    }

    const SpeechRecognitionCtor = (
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition
    ) as new () => SpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setCopilotStatus("listening");
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const text = event.results[0]?.[0]?.transcript;
      if (text) sendCopilotMessage(text);
    };
    recognition.onerror = () => setCopilotStatus(copilotMuted ? "muted" : "listening");
    recognition.onend = () => {
      // Only fall back to idle-listening if we didn't move on to thinking/speaking from a result.
      setCopilotStatus((s) => (s === "listening" ? (copilotMuted ? "muted" : "listening") : s));
    };
    recognition.start();
  }

  function cpToggleMute() {
    setCopilotMuted((m) => {
      const next = !m;
      setCopilotStatus(next ? "muted" : "listening");
      // Production continues regardless of mute state — mute never touches job status.
      if (next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return next;
    });
  }

  async function cpTogglePause() {
    if (!active) {
      alert("Create a book first — there's no production to pause yet.");
      return;
    }
    const nextAction = productionPaused ? "resume" : "pause";
    try {
      const res = await fetch("/api/copilot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: active.id, action: nextAction }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not update production status.");
      setProductionPaused(!!json.production_paused);
      setTranscript((t) => [...t, { who: "inkframe", text: json.reply }]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update production status.");
    }
  }
  const wordsWritten = (projects ?? []).reduce((sum, p) => sum + (p.project_scope?.words_written ?? 0), 0);

  // Real, computed from actual project status — never a fabricated count or message.
  const NOTIFY_STATUS: Record<string, string> = {
    READY_FOR_REVIEW: "is ready for your review",
    USER_APPROVED: "is approved — pick a platform to prepare your listing",
    READY_FOR_EXPORT: "has a listing ready — you can publish it now",
  };
  const notifications: { id: string; text: string; kind: "project" | "admin" }[] = [
    ...adminMessages.map((m) => ({ id: m.id, text: m.body, kind: "admin" as const })),
    ...(projects ?? [])
      .filter((p) => p.status in NOTIFY_STATUS)
      .map((p) => ({
        id: p.id,
        text: `${p.project_identity?.working_title || "Untitled Project"} ${NOTIFY_STATUS[p.status]}`,
        kind: "project" as const,
      })),
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <style dangerouslySetInnerHTML={{ __html: copilotCss }} />
      <div className="layout">
        <div
          className={`sidebar-overlay${sidebarOpen ? " show" : ""}`}
          id="overlay"
          onClick={() => setSidebarOpen(false)}
        ></div>
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`} id="sidebar">
          <div className="brand">
            <img src="/logo-brand.png" alt="InkFrame" />
          </div>

          <div className="nav-item active">
            <span className="nav-icon">⌂</span> Dashboard
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Create
          </div>
          <div className="nav-item" onClick={createNewBook} style={{ cursor: "pointer" }}>
            <span className="nav-icon">＋</span> New Book
          </div>
          <div
            className="nav-item"
            style={{ cursor: "pointer" }}
            onClick={() => (active ? router.push(`/job-progress?project=${active.id}`) : router.push("/books"))}
          >
            <span className="nav-icon">✎</span> AI Writing Agent
          </div>
          <div className="nav-item" onClick={() => router.push("/research")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🔎</span> Research
          </div>
          <div className="nav-item" onClick={() => router.push("/images")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🖼</span> Images
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Design
          </div>
          <div className="nav-item" onClick={() => router.push("/cover")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">◈</span> Cover Designer
          </div>
          <div className="nav-item" onClick={() => router.push("/formatter")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▦</span> Formatter
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Optimize
          </div>
          <div className="nav-item" onClick={() => router.push("/metadata")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🏷</span> Metadata
          </div>
          <div className="nav-item" onClick={() => router.push("/translate")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🌐</span> Translation
          </div>
          <div
            className="nav-item"
            style={{ cursor: "pointer" }}
            onClick={() => (active ? router.push(`/passport?project=${active.id}`) : router.push("/books"))}
          >
            <span className="nav-icon">🩺</span> Book Health Check
          </div>
          <div className="nav-item" onClick={() => router.push("/compliance")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">✓</span> Compliance Check
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Market
          </div>
          <div className="nav-item" onClick={() => router.push("/advertising")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">📈</span> Advertising
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Publish
          </div>
          <div className="nav-item" onClick={() => router.push("/publish")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🚀</span> Publishing
          </div>
          <div
            className="nav-item"
            style={{ cursor: "pointer" }}
            onClick={() => (active ? router.push(`/audiobook?project=${active.id}`) : router.push("/books"))}
          >
            <span className="nav-icon">🎧</span> Audiobook Studio
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            Library
          </div>
          <div className="nav-item" onClick={() => router.push("/books")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▤</span> My Books
          </div>
          <div className="nav-item" onClick={() => router.push("/activity")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🕓</span> Activity
          </div>
          <div className="nav-item" onClick={() => router.push("/templates")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▧</span> Templates
          </div>

          <div style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".06em", color: "var(--muted)", textTransform: "uppercase", margin: "16px 10px 4px" }}>
            AI
          </div>
          <div className="nav-item" onClick={() => setCopilotOpen((v) => !v)} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🤖</span> AI Copilot
          </div>

          <div className="nav-sep"></div>
          <div className="nav-item" onClick={() => router.push("/settings")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">⚙</span> Settings
          </div>
          <div className="nav-item" onClick={() => router.push("/help")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">?</span> Help &amp; Support
          </div>

          <div className="sidebar-footer" onClick={handleSignOut} style={{ cursor: "pointer" }} title="Sign out">
            <div className="avatar-sm" style={{ overflow: "hidden" }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : displayName ? (
                displayName[0].toUpperCase()
              ) : (
                "?"
              )}
            </div>
            <div>
              <div className="name">{displayName || "Loading…"}</div>
              <div className="plan">Sign out</div>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="hamburger" onClick={() => setSidebarOpen((v) => !v)}>
              ☰
            </button>
            <div className="search">
              🔍
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your books, or ask Inkframe anything…"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setSuggestionSession(null);
                    setSuggestionReport(null);
                    setSuggestionError(null);
                    searchInputRef.current?.blur();
                  } else if (e.key === "Enter") {
                    submitSuggestionQuery();
                  }
                }}
              />
              {suggestionLoading && <span style={{ fontSize: "11px", color: "var(--muted)" }}>Thinking…</span>}
              {!searchQuery && !suggestionLoading && <kbd>⌘K</kbd>}
            </div>
            <div className="top-right">
              <div className="bell" style={{ cursor: "pointer" }} onClick={() => setBellOpen((v) => !v)}>
                🔔
                {notifications.length > 0 && <span className="dot">{notifications.length}</span>}
                {bellOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "36px",
                      right: 0,
                      width: "280px",
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "10px",
                      boxShadow: "0 24px 48px -20px rgba(0,0,0,.6)",
                      zIndex: 50,
                    }}
                  >
                    {notifications.length === 0 ? (
                      <div style={{ fontSize: "12.5px", color: "var(--muted)", padding: "8px" }}>
                        No new notifications.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (n.kind === "admin") dismissAdminMessage(n.id);
                            else router.push(`/publish?project=${n.id}`);
                          }}
                          style={{
                            fontSize: "12.5px",
                            padding: "9px 8px",
                            borderRadius: "8px",
                            cursor: "pointer",
                          }}
                        >
                          {n.kind === "admin" && <span style={{ marginRight: 6 }}>📢</span>}
                          {n.text}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="profile" style={{ cursor: "pointer", position: "relative" }} onClick={() => setProfileMenuOpen((v) => !v)}>
                <div className="avatar-top" style={{ overflow: "hidden" }}>
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : displayName ? (
                    displayName[0].toUpperCase()
                  ) : (
                    "?"
                  )}
                </div>{" "}
                <span>{displayName || "Loading…"} ⌄</span>
                {profileMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "42px",
                      right: 0,
                      width: "200px",
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "12px",
                      padding: "6px",
                      boxShadow: "0 24px 48px -20px rgba(0,0,0,.6)",
                      zIndex: 50,
                    }}
                  >
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfileMenuOpen(false);
                        router.push("/settings");
                      }}
                      style={{ fontSize: "13px", padding: "9px 10px", borderRadius: "8px", cursor: "pointer" }}
                    >
                      🖼 Change Profile Picture
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSignOut();
                      }}
                      style={{ fontSize: "13px", padding: "9px 10px", borderRadius: "8px", cursor: "pointer" }}
                    >
                      ⏻ Sign Out
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="content">
            {suggestionError && !suggestionSession && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "rgba(226,59,76,.08)",
                  border: "1px solid rgba(226,59,76,.3)",
                  color: "var(--red, #e2536b)",
                  fontSize: "13px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span>{suggestionError}</span>
                <button
                  className="open-btn"
                  style={{ width: "auto", flexShrink: 0, padding: "6px 12px" }}
                  onClick={() => setSuggestionError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}
            {suggestionSession && (
              <SuggestionBarResults
                session={suggestionSession}
                report={suggestionReport}
                error={suggestionError}
                onDismiss={() => {
                  setSuggestionSession(null);
                  setSuggestionReport(null);
                  setSuggestionError(null);
                  setSearchQuery("");
                }}
                onOpenInResearch={() => router.push(`/research?session=${suggestionSession.id}`)}
                onFollowUp={(text) => addSuggestionFollowUp(suggestionSession.id, text)}
              />
            )}
            <div className="grid-3">
              <div>
                <div className="hero-card">
                  <div className="hero-left">
                    <div style={{ fontSize: "14px", color: "var(--muted)" }}>
                      Good to see you, {displayName || "there"}! 👋
                    </div>
                    <h1>
                      Welcome to <span className="blue">Ink</span>
                      <span className="red">Frame</span>
                    </h1>
                    <p>
                      Your AI publishing workspace is ready. Create, write, format, design, and prepare your
                      books for publication — all from one powerful platform.
                    </p>
                    <div className="hero-actions">
                      <button className="btn-primary" onClick={createNewBook}>
                        ＋ Create New Book
                      </button>
                      <div className="link-action" style={{ cursor: "pointer" }} onClick={() => router.push("/import")}>
                      ⇧ Import Manuscript
                    </div>
                    </div>
                  </div>
                  <div className="hero-art">
                    <img className="hero-photo" src="/dashboard-hero.jpg" alt="InkFrame writer at work" />
                  </div>
                </div>

                <div className="section-label">Quick Actions</div>
                <div className="qa-grid">
                  <div className="qa-card" onClick={createNewBook} style={{ cursor: "pointer" }}>
                    <div className="qa-icon" style={{ background: "rgba(47,111,237,.15)", color: "var(--blueGlow)" }}>
                      ＋
                    </div>
                    <h4>New Book</h4>
                    <span>Start writing</span>
                  </div>
                  <div className="qa-card" style={{ cursor: "pointer" }} onClick={() => router.push("/books?filter=unfinished")}>
                    <div className="qa-icon" style={{ background: "rgba(120,80,255,.15)", color: "#b7a0ff" }}>
                      ✎
                    </div>
                    <h4>Continue Writing</h4>
                    <span>Pick up where you left off</span>
                  </div>
                  <div className="qa-card" style={{ cursor: "pointer" }} onClick={() => router.push("/formatter")}>
                    <div className="qa-icon" style={{ background: "rgba(226,59,76,.15)", color: "var(--redGlow)" }}>
                      ▤
                    </div>
                    <h4>Format Book</h4>
                    <span>Make it publish ready</span>
                  </div>
                  <div className="qa-card" style={{ cursor: "pointer" }} onClick={() => router.push("/cover")}>
                    <div className="qa-icon" style={{ background: "rgba(255,150,50,.15)", color: "#ffb066" }}>
                      ◈
                    </div>
                    <h4>Create Cover</h4>
                    <span>Design stunning covers</span>
                  </div>
                  <div className="qa-card" onClick={() => router.push("/publish")} style={{ cursor: "pointer" }}>
                    <div className="qa-icon" style={{ background: "rgba(40,200,140,.15)", color: "#5fe3b8" }}>
                      ⇧
                    </div>
                    <h4>Export / Publish</h4>
                    <span>Publish to multiple platforms</span>
                  </div>
                  <div className="qa-card" onClick={() => router.push("/translate")} style={{ cursor: "pointer" }}>
                    <div className="qa-icon" style={{ background: "rgba(76,139,255,.15)", color: "var(--blueGlow)" }}>
                      🌐
                    </div>
                    <h4>Translate Book</h4>
                    <span>Convert to another language</span>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: "24px" }}>
                  <div className="panel-head">
                    <h3>Recent Projects</h3>
                    <span className="view-all" style={{ cursor: "pointer" }} onClick={() => router.push("/books")}>
                      View All
                    </span>
                  </div>
                  <div id="projects-list">
                    {visibleProjects && visibleProjects.length > 0 ? (
                      visibleProjects.map((p) => (
                        <div
                          className="project-row"
                          key={p.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => openProject(p.id, p.status)}
                        >
                          {coverThumbUrl(p) ? (
                            <img className="book-thumb" src={coverThumbUrl(p)!} alt="" style={{ objectFit: "cover" }} />
                          ) : (
                            <div className="book-thumb">IF</div>
                          )}
                          <div>
                            <div className="project-name">
                              {p.project_identity?.working_title || "Untitled Project"}
                              <span className={`tag ${tagClass(p.status)}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                            </div>
                            <div className="project-sub">{p.project_identity?.subtitle || ""}</div>
                          </div>
                          <div className="project-meta">
                            {relativeTime(p.updated_at)}
                            <div className="bar-mini">
                              <div className="bar-mini-fill" style={{ width: `${pctFor(p)}%` }}></div>
                            </div>
                            {pctFor(p)}%
                          </div>
                        </div>
                      ))
                    ) : null}
                  </div>
                  {projects && projects.length === 0 && (
                    <div id="projects-empty" style={{ textAlign: "center", padding: "34px 10px" }}>
                      <div style={{ fontSize: "34px", marginBottom: "10px" }}>📖</div>
                      <div style={{ fontWeight: 600, marginBottom: "4px" }}>No projects yet</div>
                      <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "16px" }}>
                        Start your first book and it will show up here.
                      </div>
                      <button className="btn-primary" onClick={createNewBook}>
                        ＋ Create New Book
                      </button>
                    </div>
                  )}
                  {projects && projects.length > 0 && visibleProjects && visibleProjects.length === 0 && (
                    <div style={{ textAlign: "center", padding: "34px 10px", fontSize: "13px", color: "var(--muted)" }}>
                      No books match &quot;{searchQuery}&quot;.
                    </div>
                  )}
                </div>
              </div>

              <div className="right-col">
                <div className="agent-card" id="agent-card">
                  {active ? (
                    <>
                      <div className="agent-head">
                        <div className="lbl">✦ AI Writing Agent</div>
                        <span className="running-pill">Running</span>
                      </div>
                      <div className="agent-desc">Your book is currently being written by InkFrame AI.</div>
                      <div className="agent-book">
                        {coverThumbUrl(active) ? (
                          <img className="cover" src={coverThumbUrl(active)!} alt="" style={{ objectFit: "cover" }} />
                        ) : (
                          <div className="cover"></div>
                        )}
                        <div>
                          <div className="title">{active.project_identity?.working_title || "Untitled Project"}</div>
                          <div className="sub">{active.project_identity?.subtitle || ""}</div>
                        </div>
                      </div>
                      <div className="pct-row">
                        <span>{STATUS_LABEL[active.status] ?? active.status}</span>
                        <span>{pctFor(active)}%</span>
                      </div>
                      <div className="agent-bar">
                        <div className="agent-bar-fill" style={{ width: `${pctFor(active)}%` }}></div>
                      </div>
                      <button
                        className="open-btn"
                        onClick={() =>
                          router.push(
                            ["IDEA", "BLUEPRINT", "AWAITING_APPROVAL"].includes(active.status)
                              ? `/wizard?project=${active.id}`
                              : `/job-progress?project=${active.id}`
                          )
                        }
                      >
                        Open Writing Agent <span>›</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="agent-head">
                        <div className="lbl">✦ AI Writing Agent</div>
                        <span className="running-pill" style={{ background: "rgba(141,150,171,.15)", color: "var(--muted)" }}>
                          Idle
                        </span>
                      </div>
                      <div className="agent-desc">
                        No book in progress. Create a new book and the AI Writing Agent will get to work in the
                        background.
                      </div>
                      <button className="open-btn" onClick={createNewBook}>
                        ＋ Start a New Book <span>›</span>
                      </button>
                    </>
                  )}
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Your Progress</h3>
                    <span className="view-all">This Month ⌄</span>
                  </div>
                  <div className="stat-grid">
                    <div className="stat-box">
                      <div className="lbl">Books in Progress</div>
                      <div className="val">{(projects?.length ?? 0) - completedCount}</div>
                    </div>
                    <div className="stat-box">
                      <div className="lbl">Words Written</div>
                      <div className="val">{wordsWritten.toLocaleString()}</div>
                    </div>
                    <div className="stat-box">
                      <div className="lbl">Books Completed</div>
                      <div className="val">{completedCount}</div>
                    </div>
                    <div className="stat-box">
                      <div className="lbl">Exports</div>
                      <div className="val">{exportCount}</div>
                    </div>
                  </div>
                </div>

                {tasks.length > 0 && (
                  <div className="panel">
                    <div className="panel-head">
                      <h3>Tasks</h3>
                    </div>
                    {tasks.map((t) => (
                      <div className="export-row" key={t.projectId} style={{ cursor: "pointer" }} onClick={() => router.push(t.route)}>
                        <span className="name">⚠ Complete {t.issue} for {t.title}</span>
                        <span className="check" style={{ marginLeft: "auto" }}>Fix ›</span>
                      </div>
                    ))}
                  </div>
                )}

                {recentActivity.length > 0 && (
                  <div className="panel">
                    <div className="panel-head">
                      <h3>Recent Activity</h3>
                      <span className="view-all" style={{ cursor: "pointer" }} onClick={() => router.push("/activity")}>
                        View All
                      </span>
                    </div>
                    {recentActivity.map((a, i) => (
                      <div className="export-row" key={i}>
                        <span className="name">{a.title} — {a.event}</span>
                        <span className="time">{a.time}</span>
                      </div>
                    ))}
                  </div>
                )}

                {publishingJobs.length > 0 && (
                  <div className="panel">
                    <div className="panel-head">
                      <h3>Publishing Jobs</h3>
                    </div>
                    {publishingJobs.map((j) => (
                      <div
                        className="export-row"
                        key={`${j.projectId}-${j.targetPlatform}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => router.push(`/publish?project=${j.projectId}`)}
                      >
                        <span className="name">
                          {j.title} — {j.targetPlatform} KDP Preparation
                          {(j.status === "queued" || j.status === "running") && ` (${j.stagesDone}/${j.stagesTotal})`}
                        </span>
                        <span className={j.status === "needs_attention" ? "time" : "check"} style={{ marginLeft: "auto" }}>
                          {j.status === "queued" && "Queued"}
                          {j.status === "running" && "Preparing…"}
                          {j.status === "needs_attention" && "⚠ Needs Attention"}
                          {j.status === "ready_for_review" && "✓ Ready for Review"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="panel">
                  <div className="panel-head">
                    <h3>Publishing Platforms</h3>
                    <span className="view-all">Manage</span>
                  </div>
                  <div className="plat-grid">
                    <div className="plat-box">amazon kdp</div>
                    <div className="plat-box">kobo</div>
                    <div className="plat-box">Google Books</div>
                    <div className="plat-box">Apple Books</div>
                    <div className="plat-more">＋ More coming soon</div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <h3>Recent Exports</h3>
                    <span className="view-all">View All</span>
                  </div>
                  {exportCount === 0 && (
                    <div style={{ textAlign: "center", padding: "18px 4px", color: "var(--muted)", fontSize: "12.5px" }}>
                      No exports yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button id="copilot-launcher" onClick={() => setCopilotOpen((v) => !v)}>
        🎙️
      </button>

      <div id="copilot-panel" className={copilotOpen ? "open" : ""}>
        <div className="cp-header">
          <span className="cp-title">✦ InkFrame AI Copilot</span>
          <span className={`cp-status ${copilotStatus}`} id="cp-status-badge">
            {copilotStatus === "listening" && "🎙️ Listening"}
            {copilotStatus === "muted" && "🔇 Muted — not listening"}
            {copilotStatus === "thinking" && "💬 Thinking"}
            {copilotStatus === "speaking" && "🔊 Speaking"}
          </span>
        </div>
        <div className="cp-transcript" id="cp-transcript">
          {transcript.map((m, i) => (
            <div className="cp-msg" key={i}>
              <div className="who">{m.who === "inkframe" ? "INKFRAME" : "YOU"}</div>
              <div>{m.text}</div>
              {m.suggestedAction && (
                <button
                  onClick={() => router.push(m.suggestedAction!.route)}
                  style={{
                    marginTop: "8px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    background: "rgba(255,255,255,.06)",
                    border: "1px solid var(--border)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {m.suggestedAction.label} →
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="cp-controls">
          <button className="cp-btn talk" id="cp-talk-btn" onClick={cpToggleListen}>
            🎙️ Talk to InkFrame
          </button>
        </div>
        <div className="cp-sub-controls">
          <button
            className={`cp-sub-btn${copilotMuted ? " muted-active" : ""}`}
            id="cp-mute-btn"
            onClick={cpToggleMute}
          >
            {copilotMuted ? "🎙️ Unmute" : "🔇 Mute"}
          </button>
          <button
            className={`cp-sub-btn${productionPaused ? " paused" : ""}`}
            id="cp-pause-btn"
            onClick={cpTogglePause}
          >
            {productionPaused ? "▶ Resume Production" : "⏸ Pause Production"}
          </button>
        </div>
      </div>
    </>
  );
}
