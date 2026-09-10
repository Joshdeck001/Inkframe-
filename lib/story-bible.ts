/**
 * Story Bible (fiction continuity) — the `story_bible` table has existed
 * since the original schema, but nothing ever read or wrote it; the
 * Writing Agent's own doc comment called this out as deferred ("lands
 * once the fuller writing-prompt specs are available"). This is that
 * wiring: a shared shape + formatter so /story-bible (the editor) and
 * lib/writing-agent.ts (the consumer) agree on what these jsonb blobs
 * actually contain, instead of each guessing independently.
 *
 * Each of characters/locations/world_rules/important_objects/
 * secrets_reveals/timeline is a simple name -> freeform description map
 * — deliberately not a dozen sub-fields per character, so the editor
 * stays one reusable "named entries" component instead of six different
 * forms. plot_threads is the one array field, each tagged open/closed,
 * matching the table's own column comment.
 */
export type NamedEntries = Record<string, string>;
export type PlotThread = { thread: string; status: "open" | "closed" };

export type StoryBible = {
  characters: NamedEntries;
  locations: NamedEntries;
  timeline: NamedEntries;
  world_rules: NamedEntries;
  important_objects: NamedEntries;
  secrets_reveals: NamedEntries;
  plot_threads: PlotThread[];
};

export const EMPTY_STORY_BIBLE: StoryBible = {
  characters: {},
  locations: {},
  timeline: {},
  world_rules: {},
  important_objects: {},
  secrets_reveals: {},
  plot_threads: [],
};

function formatNamedEntries(label: string, entries: NamedEntries | null | undefined): string | null {
  const keys = Object.keys(entries ?? {});
  if (keys.length === 0) return null;
  return `${label}:\n` + keys.map((k) => `- ${k}: ${entries![k]}`).join("\n");
}

/**
 * Turns a story bible row into prompt-ready fact lines — only for
 * sections that actually have content, so a project with no bible yet
 * (or a nonfiction book that never uses one) adds nothing to the prompt.
 */
export function storyBibleToPromptFacts(bible: Partial<StoryBible> | null | undefined): string[] {
  if (!bible) return [];
  const openThreads = (bible.plot_threads ?? []).filter((t) => t.status === "open");
  return [
    formatNamedEntries("Known characters (keep names, traits, and relationships consistent)", bible.characters),
    formatNamedEntries("Known locations", bible.locations),
    formatNamedEntries("Timeline of established events", bible.timeline),
    formatNamedEntries("World rules to respect", bible.world_rules),
    formatNamedEntries("Important objects", bible.important_objects),
    formatNamedEntries("Secrets/reveals already established (don't reveal early, don't contradict)", bible.secrets_reveals),
    openThreads.length > 0 ? `Open plot threads still needing resolution:\n` + openThreads.map((t) => `- ${t.thread}`).join("\n") : null,
  ].filter((l): l is string => l !== null);
}
