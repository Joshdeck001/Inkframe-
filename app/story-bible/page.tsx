"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sharedSecondaryCss } from "@/content/shared-secondary.css";
import { EMPTY_STORY_BIBLE, type StoryBible, type PlotThread } from "@/lib/story-bible";

export const dynamic = "force-dynamic";

function NamedEntriesEditor({
  label,
  hint,
  entries,
  onChange,
}: {
  label: string;
  hint: string;
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const names = Object.keys(entries);

  function add() {
    if (!newName.trim()) return;
    onChange({ ...entries, [newName.trim()]: newDesc.trim() });
    setNewName("");
    setNewDesc("");
  }

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>{label}</div>
      <p className="hint" style={{ marginBottom: "12px" }}>{hint}</p>
      {names.length === 0 && <p className="hint" style={{ marginBottom: "10px" }}>Nothing added yet.</p>}
      {names.map((name) => (
        <div key={name} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <input
              value={name}
              onChange={(e) => {
                const next = { ...entries };
                const val = next[name];
                delete next[name];
                next[e.target.value] = val;
                onChange(next);
              }}
              style={{ fontWeight: 600, marginBottom: "4px" }}
            />
            <textarea
              value={entries[name]}
              onChange={(e) => onChange({ ...entries, [name]: e.target.value })}
              rows={2}
              style={{ width: "100%", background: "#0d1626", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", color: "#fff", fontSize: "13px", fontFamily: "inherit" }}
            />
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: "6px 10px" }}
            onClick={() => {
              const next = { ...entries };
              delete next[name];
              onChange(next);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: "0 0 160px" }} />
        <input placeholder="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={add}>+ Add</button>
      </div>
    </div>
  );
}

function PlotThreadsEditor({ threads, onChange }: { threads: PlotThread[]; onChange: (next: PlotThread[]) => void }) {
  const [newThread, setNewThread] = useState("");

  return (
    <div className="panel">
      <div style={{ fontWeight: 700, marginBottom: "4px" }}>Plot Threads</div>
      <p className="hint" style={{ marginBottom: "12px" }}>Track open storylines so the Writing Agent knows what still needs resolving.</p>
      {threads.length === 0 && <p className="hint" style={{ marginBottom: "10px" }}>No plot threads yet.</p>}
      {threads.map((t, i) => (
        <div key={i} className="check-row">
          <span>{t.thread}</span>
          <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: "12px" }}
              onClick={() => onChange(threads.map((x, j) => (j === i ? { ...x, status: x.status === "open" ? "closed" : "open" } : x)))}
            >
              {t.status === "open" ? "Open" : "Closed"}
            </button>
            <button className="btn btn-secondary" style={{ padding: "4px 10px" }} onClick={() => onChange(threads.filter((_, j) => j !== i))}>
              ✕
            </button>
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
        <input placeholder="e.g. Who sabotaged the merger?" value={newThread} onChange={(e) => setNewThread(e.target.value)} style={{ flex: 1 }} />
        <button
          className="btn btn-secondary"
          onClick={() => {
            if (!newThread.trim()) return;
            onChange([...threads, { thread: newThread.trim(), status: "open" }]);
            setNewThread("");
          }}
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function StoryBibleBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const supabase = createClient();

  const [bible, setBible] = useState<StoryBible | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const skipNextAutosave = useRef(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("story_bible").select("*").eq("project_id", projectId).maybeSingle();
      if (cancelled) return;
      skipNextAutosave.current = true;
      setBible(
        data
          ? {
              characters: data.characters ?? {},
              locations: data.locations ?? {},
              timeline: data.timeline ?? {},
              world_rules: data.world_rules ?? {},
              important_objects: data.important_objects ?? {},
              secrets_reveals: data.secrets_reveals ?? {},
              plot_threads: data.plot_threads ?? [],
            }
          : EMPTY_STORY_BIBLE
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Real autosave: debounced, skips the very first render after a fresh
  // load so opening the page never immediately writes an identical row.
  useEffect(() => {
    if (!bible || !projectId) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    setSaveState("saving");
    const timer = setTimeout(async () => {
      await supabase.from("story_bible").upsert({ project_id: projectId, ...bible }, { onConflict: "project_id" });
      setSaveState("saved");
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bible, projectId]);

  if (!projectId) {
    return (
      <div className="empty-panel">
        <div className="ei">📖</div>
        <h3>No project selected</h3>
        <p>Open a book from My Books to edit its Story Bible.</p>
        <button className="btn btn-primary" onClick={() => router.push("/books")}>
          Go to My Books
        </button>
      </div>
    );
  }

  if (!bible) return <p className="hint">Loading Story Bible…</p>;

  return (
    <>
      <div className="safety-note" style={{ marginBottom: "20px" }}>
        The Writing Agent reads this automatically when drafting new chapters — characters, locations, world
        rules, and open plot threads all get folded into its prompt so it stays consistent with what you&apos;ve
        already established. It does not rewrite chapters already written; add entries as you go.
      </div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--bg)", padding: "6px 0 14px", fontSize: "12.5px", color: "var(--muted)" }}>
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "✓ Saved"}
      </div>

      <NamedEntriesEditor
        label="Characters"
        hint="Name, role, personality, relationships, goals — whatever matters for consistency."
        entries={bible.characters}
        onChange={(characters) => setBible({ ...bible, characters })}
      />
      <NamedEntriesEditor
        label="Locations"
        hint="Places that recur across chapters."
        entries={bible.locations}
        onChange={(locations) => setBible({ ...bible, locations })}
      />
      <NamedEntriesEditor
        label="Timeline"
        hint="Established events in the story's own chronology."
        entries={bible.timeline}
        onChange={(timeline) => setBible({ ...bible, timeline })}
      />
      <NamedEntriesEditor
        label="World Rules"
        hint="Anything the story must stay consistent with — magic systems, technology limits, social rules."
        entries={bible.world_rules}
        onChange={(world_rules) => setBible({ ...bible, world_rules })}
      />
      <NamedEntriesEditor
        label="Important Objects"
        hint="Items that matter to the plot."
        entries={bible.important_objects}
        onChange={(important_objects) => setBible({ ...bible, important_objects })}
      />
      <NamedEntriesEditor
        label="Secrets &amp; Reveals"
        hint="Things established but not yet revealed to the reader — so the AI doesn't spoil them early."
        entries={bible.secrets_reveals}
        onChange={(secrets_reveals) => setBible({ ...bible, secrets_reveals })}
      />
      <PlotThreadsEditor threads={bible.plot_threads} onChange={(plot_threads) => setBible({ ...bible, plot_threads })} />

      <button className="btn btn-secondary" onClick={() => router.push(`/passport?project=${projectId}`)}>
        ← Back to Book Passport
      </button>
    </>
  );
}

export default function StoryBiblePage() {
  const router = useRouter();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sharedSecondaryCss }} />
      <header>
        <div className="logo">
          <span className="ink">Ink</span>
          <span className="frame">Frame</span>
        </div>
        <button className="back-btn" onClick={() => router.push("/dashboard")}>
          ← Back to Dashboard
        </button>
      </header>
      <div className="wrap">
        <h1>📖 Story Bible</h1>
        <p className="subtitle">Characters, locations, and continuity facts for this book — fiction projects only.</p>
        <Suspense fallback={<p className="hint">Loading…</p>}>
          <StoryBibleBody />
        </Suspense>
      </div>
    </>
  );
}
