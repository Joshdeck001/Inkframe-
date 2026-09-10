/**
 * Real, deterministic text-frequency analysis over a research corpus —
 * titles, descriptions, snippets, keyword rows the author or a live
 * search actually returned. No AI call anywhere in this file: a count is
 * either right or wrong, never a plausible-sounding guess, which is
 * exactly what the spec's "frequency indicates usage, not guaranteed
 * sales" distinction requires.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those", "as",
  "at", "by", "from", "into", "about", "than", "then", "so", "such", "not", "no", "your",
  "you", "his", "her", "their", "our", "my", "i", "he", "she", "they", "we", "will", "can",
  "how", "what", "when", "where", "why", "who", "which", "do", "does", "did", "book", "books",
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, "")) // "billionaire's" and "billionaire" should count as the same word
    .filter((w) => w.length > 1);
}

function significantTokens(text: string): string[] {
  return tokenize(text).filter((w) => !STOPWORDS.has(w));
}

export type FrequencyEntry = { term: string; occurrences: number; corpusSize: number; frequencyPct: number };

/**
 * Word frequency across a corpus of texts (spec section 9: "word
 * frequency... reported with context" — occurrences, corpus size, and
 * percentage together, never a bare count).
 */
export function wordFrequency(texts: string[], limit = 30): FrequencyEntry[] {
  const corpusSize = texts.length;
  const counts = new Map<string, number>();
  for (const text of texts) {
    const seen = new Set(significantTokens(text));
    for (const w of seen) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([term, occurrences]) => ({ term, occurrences, corpusSize, frequencyPct: corpusSize ? Math.round((occurrences / corpusSize) * 1000) / 10 : 0 }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

function ngrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) grams.push(tokens.slice(i, i + n).join(" "));
  return grams;
}

/** Bigrams/trigrams across the corpus, same occurrences/corpusSize/frequencyPct shape as wordFrequency. */
export function phraseFrequency(texts: string[], n: 2 | 3, limit = 20): FrequencyEntry[] {
  const corpusSize = texts.length;
  const counts = new Map<string, number>();
  for (const text of texts) {
    const tokens = tokenize(text).filter((w) => !STOPWORDS.has(w) || w.length > 3); // keep some connector words inside phrases
    const seen = new Set(ngrams(tokens, n));
    for (const g of seen) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1) // a phrase appearing exactly once across the whole corpus isn't a "pattern"
    .map(([term, occurrences]) => ({ term, occurrences, corpusSize, frequencyPct: corpusSize ? Math.round((occurrences / corpusSize) * 1000) / 10 : 0 }))
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

/** Exact occurrence count for a specific known phrase — the "Phrase: 'second chance', Occurrences: 42..." example from the spec. */
export function specificPhraseFrequency(texts: string[], phrase: string): FrequencyEntry {
  const needle = phrase.toLowerCase().trim();
  const occurrences = texts.filter((t) => t.toLowerCase().includes(needle)).length;
  const corpusSize = texts.length;
  return { term: phrase, occurrences, corpusSize, frequencyPct: corpusSize ? Math.round((occurrences / corpusSize) * 1000) / 10 : 0 };
}

export type KeywordCluster = { label: string; keywords: string[] };

/**
 * Groups a flat keyword list into clusters by shared significant tokens —
 * a real structural grouping (union-find over shared-word edges), not an
 * AI guess at "what topics feel related." Two keywords cluster together
 * only if they share an actual word. Deterministic and reproducible on
 * the same input.
 */
export function clusterKeywords(keywords: string[]): KeywordCluster[] {
  const unique = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const tokensByKeyword = unique.map((k) => new Set(significantTokens(k)));

  const parent = unique.map((_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      let shared = 0;
      for (const t of tokensByKeyword[i]) if (tokensByKeyword[j].has(t)) shared++;
      if (shared > 0) union(i, j);
    }
  }

  const groups = new Map<number, string[]>();
  for (let i = 0; i < unique.length; i++) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(unique[i]);
    groups.set(root, list);
  }

  return [...groups.values()]
    .map((keywordsInGroup) => {
      // Label the cluster with its most frequent significant token across the group's own keywords.
      const tokenCounts = new Map<string, number>();
      for (const k of keywordsInGroup) {
        for (const t of significantTokens(k)) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
      }
      const label = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? keywordsInGroup[0];
      return { label, keywords: keywordsInGroup.sort((a, b) => a.length - b.length) };
    })
    .sort((a, b) => b.keywords.length - a.keywords.length);
}
