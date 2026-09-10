/**
 * Cross-platform book matching and observed price history, computed only
 * from clips the user has already captured with InkframeScout's one-click
 * capture (see extension/README.md) — never from a live lookup against
 * any marketplace. Everything here is a real join/group over rows already
 * in scout_clips; nothing is estimated, predicted, or scored.
 */

export type MatchableClip = {
  id: string;
  marketplace: string;
  title: string | null;
  author: string | null;
  external_id: string | null;
  isbn: string | null;
  price: number | null;
  clipped_at: string;
};

export type CanonicalGroup = {
  key: string;
  matchBasis: "isbn" | "title_author";
  confidence: "high" | "low";
  clips: MatchableClip[];
};

// Unicode combining diacritical marks (U+0300-U+036F), stripped after NFD
// decomposition so "Café" and "Cafe" normalize to the same key.
const DIACRITIC_MARKS = /[\u0300-\u036f]/g;

function normalize(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Groups clips that appear to be the same physical book across
 * marketplaces. An exact ISBN match is a real shared identifier (high
 * confidence). Without one, clips are grouped only when normalized title
 * AND author both match exactly — still labeled low confidence and
 * "possible match" in the UI, never presented as confirmed.
 */
export function groupClipsByCanonicalBook(clips: MatchableClip[]): CanonicalGroup[] {
  const isbnGroups = new Map<string, MatchableClip[]>();
  const remaining: MatchableClip[] = [];

  for (const clip of clips) {
    if (clip.isbn) {
      const key = clip.isbn.replace(/[^0-9Xx]/g, "").toUpperCase();
      if (!isbnGroups.has(key)) isbnGroups.set(key, []);
      isbnGroups.get(key)!.push(clip);
    } else {
      remaining.push(clip);
    }
  }

  const titleAuthorGroups = new Map<string, MatchableClip[]>();
  for (const clip of remaining) {
    const title = normalize(clip.title);
    const author = normalize(clip.author);
    if (!title || !author) continue;
    const key = `${title}::${author}`;
    if (!titleAuthorGroups.has(key)) titleAuthorGroups.set(key, []);
    titleAuthorGroups.get(key)!.push(clip);
  }

  const groups: CanonicalGroup[] = [];
  for (const [key, groupClips] of isbnGroups) {
    if (groupClips.length < 2) continue;
    groups.push({ key, matchBasis: "isbn", confidence: "high", clips: groupClips });
  }
  for (const [key, groupClips] of titleAuthorGroups) {
    // Only worth surfacing as a cross-platform match if it actually spans more than one marketplace.
    const marketplaces = new Set(groupClips.map((c) => c.marketplace));
    if (groupClips.length < 2 || marketplaces.size < 2) continue;
    groups.push({ key, matchBasis: "title_author", confidence: "low", clips: groupClips });
  }
  return groups;
}

export type PriceObservation = { price: number; clipped_at: string; marketplace: string };
export type PriceHistoryGroup = { key: string; marketplace: string; observations: PriceObservation[] };

/**
 * Real, timestamped price points from the user's own repeated clips of
 * the same listing (same marketplace + external_id, clipped more than
 * once over time) — an actual observation log, not an estimate or a
 * vendor feed. Groups with only one observation are dropped; there's no
 * "history" in a single point.
 */
export function buildObservedPriceHistory(clips: MatchableClip[]): PriceHistoryGroup[] {
  const groups = new Map<string, MatchableClip[]>();
  for (const clip of clips) {
    if (clip.price == null || !clip.external_id) continue;
    const key = `${clip.marketplace}::${clip.external_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(clip);
  }

  const result: PriceHistoryGroup[] = [];
  for (const [key, groupClips] of groups) {
    if (groupClips.length < 2) continue;
    const observations = groupClips
      .slice()
      .sort((a, b) => new Date(a.clipped_at).getTime() - new Date(b.clipped_at).getTime())
      .map((c) => ({ price: c.price as number, clipped_at: c.clipped_at, marketplace: c.marketplace }));
    result.push({ key, marketplace: groupClips[0].marketplace, observations });
  }
  return result;
}
