/**
 * A real adapter for live web search, not a simulation — but there is no
 * search API key configured in this deployment today, so this always
 * returns `{ unavailable: true }` right now rather than letting a model
 * pretend it "checked the web". Brave Search was picked as the intended
 * provider because it's a plain paid REST API (no scraping/ToS
 * ambiguity, unlike Amazon — see README), not because it's wired to
 * anything live yet. The moment BRAVE_SEARCH_API_KEY is set, real results
 * start flowing through the exact same call site in
 * lib/research-report.ts with no further code changes.
 *
 * Never call this and silently treat `unavailable` as "no results" —
 * always surface the `reason` to the user/report so "I searched the web
 * and found nothing" is never confused with "I never searched at all".
 */
export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebSearchOutcome = { available: true; results: WebSearchResult[] } | { available: false; reason: string };

export async function searchWeb(query: string): Promise<WebSearchOutcome> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      reason: "No web search provider is configured (set BRAVE_SEARCH_API_KEY) — this research relies on AI general knowledge and whatever you entered manually below, not a live web check.",
    };
  }

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    });
    if (!res.ok) {
      return { available: false, reason: `Brave Search returned an error (HTTP ${res.status}) — treat this as no live data available.` };
    }
    const json = await res.json();
    const results: WebSearchResult[] = (json?.web?.results ?? []).map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
    return { available: true, results };
  } catch (e) {
    return { available: false, reason: `Web search request failed (${e instanceof Error ? e.message : String(e)}) — treat this as no live data available.` };
  }
}
