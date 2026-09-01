"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { css, title } from "@/content/dashboard";
import { copilotCss } from "@/content/dashboard-copilot.css";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  status: string;
  updated_at: string;
  project_identity: { working_title: string | null; subtitle: string | null } | null;
  project_scope: { words_written: number | null; target_word_count: number | null } | null;
};

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
  const [transcript, setTranscript] = useState<{ who: "user" | "inkframe"; text: string }[]>([
    { who: "inkframe", text: "How can I help with this book?" },
  ]);

  const [displayName, setDisplayName] = useState("");
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [exportCount, setExportCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    document.title = title;
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
      if (!cancelled) setDisplayName(name);

      const { data: projectRows } = await supabase
        .from("projects")
        .select(
          "id, status, updated_at, project_identity(working_title, subtitle), project_scope(words_written, target_word_count)"
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
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth");
    router.refresh();
  }

  function createNewBook() {
    router.push("/wizard");
  }

  function cpToggleListen() {
    if (copilotMuted) {
      alert("InkFrame is muted. Unmute first to talk.");
      return;
    }
    setCopilotStatus("thinking");
    setTimeout(() => {
      setCopilotStatus("speaking");
      setTranscript((t) => [...t, { who: "inkframe", text: "Got it — I'll keep working on that." }]);
      setTimeout(() => setCopilotStatus("listening"), 1800);
    }, 1000);
  }

  function cpToggleMute() {
    setCopilotMuted((m) => {
      const next = !m;
      setCopilotStatus(next ? "muted" : "listening");
      // Production continues regardless of mute state — mute never touches job status.
      return next;
    });
  }

  function cpTogglePause() {
    setProductionPaused((p) => {
      const next = !p;
      // Voice/listening state is untouched here — pausing production never mutes the mic.
      setTranscript((t) => [
        ...t,
        { who: "inkframe", text: next ? "Production paused. I'll stop working until you resume." : "Resuming production now." },
      ]);
      return next;
    });
  }

  const active = projects?.find((p) => p.status !== "EXPORTED") ?? null;
  const wordsWritten = (projects ?? []).reduce((sum, p) => sum + (p.project_scope?.words_written ?? 0), 0);

  // Real, computed from actual project status — never a fabricated count or message.
  const NOTIFY_STATUS: Record<string, string> = {
    READY_FOR_REVIEW: "is ready for your review",
    USER_APPROVED: "is approved — pick a platform to prepare your listing",
    READY_FOR_EXPORT: "has a listing ready — you can publish it now",
  };
  const notifications = (projects ?? [])
    .filter((p) => p.status in NOTIFY_STATUS)
    .map((p) => ({
      id: p.id,
      text: `${p.project_identity?.working_title || "Untitled Project"} ${NOTIFY_STATUS[p.status]}`,
    }));

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
          <div
            className="nav-item"
            style={{ cursor: "pointer" }}
            onClick={() => (active ? router.push(`/job-progress?project=${active.id}`) : router.push("/books"))}
          >
            <span className="nav-icon">✎</span> AI Writing Agent
          </div>
          <div className="nav-item" onClick={() => router.push("/books")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▤</span> My Books
          </div>
          <div className="nav-item" onClick={createNewBook} style={{ cursor: "pointer" }}>
            <span className="nav-icon">＋</span> New Book
          </div>
          <div className="nav-item" onClick={() => router.push("/cover")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">◈</span> Cover Designer
          </div>
          <div className="nav-item" onClick={() => router.push("/formatter")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▦</span> Formatter
          </div>
          <div className="nav-item" onClick={() => router.push("/images")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🖼</span> Images
          </div>
          <div className="nav-item" onClick={() => router.push("/research")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🔎</span> Research
          </div>
          <div className="nav-item" onClick={() => router.push("/metadata")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🏷</span> Metadata
          </div>
          <div className="nav-item" onClick={() => router.push("/translate")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🌐</span> Translation
          </div>
          <div className="nav-item" onClick={() => router.push("/advertising")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">📈</span> Advertising
          </div>
          <div className="nav-item" onClick={() => router.push("/publish")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🚀</span> Publishing
          </div>
          <div className="nav-item" onClick={() => setCopilotOpen((v) => !v)} style={{ cursor: "pointer" }}>
            <span className="nav-icon">🤖</span> AI Copilot
          </div>

          <div className="nav-sep"></div>
          <div className="nav-item" onClick={() => router.push("/templates")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">▧</span> Templates
          </div>
          <div className="nav-item" onClick={() => router.push("/compliance")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">✓</span> Compliance Check
          </div>
          <div className="nav-item" onClick={() => router.push("/settings")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">⚙</span> Settings
          </div>
          <div className="nav-item" onClick={() => router.push("/help")} style={{ cursor: "pointer" }}>
            <span className="nav-icon">?</span> Help &amp; Support
          </div>

          <div className="sidebar-footer" onClick={handleSignOut} style={{ cursor: "pointer" }} title="Sign out">
            <div className="avatar-sm">{displayName ? displayName[0].toUpperCase() : "?"}</div>
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
              🔍 Search anything... <kbd>⌘K</kbd>
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
                            router.push(`/publish?project=${n.id}`);
                          }}
                          style={{
                            fontSize: "12.5px",
                            padding: "9px 8px",
                            borderRadius: "8px",
                            cursor: "pointer",
                          }}
                        >
                          {n.text}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="profile" onClick={handleSignOut} style={{ cursor: "pointer" }}>
                <div className="avatar-top">{displayName ? displayName[0].toUpperCase() : "?"}</div>{" "}
                {displayName || "Loading…"} ⌄
              </div>
            </div>
          </header>

          <div className="content">
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
                      <div className="link-action">⇧ Import Manuscript</div>
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
                  <div className="qa-card">
                    <div className="qa-icon" style={{ background: "rgba(120,80,255,.15)", color: "#b7a0ff" }}>
                      ✎
                    </div>
                    <h4>Continue Writing</h4>
                    <span>Pick up where you left off</span>
                  </div>
                  <div className="qa-card">
                    <div className="qa-icon" style={{ background: "rgba(226,59,76,.15)", color: "var(--redGlow)" }}>
                      ▤
                    </div>
                    <h4>Format Book</h4>
                    <span>Make it publish ready</span>
                  </div>
                  <div className="qa-card">
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
                    <span className="view-all">View All</span>
                  </div>
                  <div id="projects-list">
                    {projects && projects.length > 0 ? (
                      projects.map((p) => (
                        <div className="project-row" key={p.id}>
                          <div className="book-thumb">IF</div>
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
                        <div className="cover"></div>
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
                      <button className="open-btn" onClick={() => router.push("/job-progress")}>
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
