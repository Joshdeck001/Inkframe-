/**
 * Runs exactly once, only when injected by popup.js after the user
 * clicks "Clip This Book" — never a persistent content script, never
 * auto-run on page load, never re-run on scroll/DOM mutation. It reads
 * only what's already rendered in the page at the moment of the click;
 * it never clicks, expands, scrolls, or submits anything on the host
 * page itself. If a field genuinely isn't visible, it's left null —
 * never guessed.
 *
 * Amazon/Google Play Books/Kobo can and do change their markup over
 * time; each extractor below tries a few independent, well-known
 * selectors per field rather than a single brittle one, and simply
 * returns null for anything it can't confidently find instead of
 * guessing from an unrelated element.
 */
(function extractInkframeScoutClip() {
  // Bumped when extraction logic changes for a marketplace, so a stored
  // observation always carries the exact adapter version that produced
  // it (spec: "Versioning" / "Historical records should retain the
  // version used to produce them").
  const EXTENSION_VERSION = "2.1.0";
  const ADAPTER_VERSIONS = {
    amazon: "amazon-1.1.0",
    google_play_books: "google_play_books-1.1.0",
    kobo: "kobo-1.1.0",
  };

  function text(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const value = el?.textContent?.trim();
      if (value) return value;
    }
    return null;
  }

  function num(selectors) {
    const raw = text(selectors);
    if (!raw) return null;
    const match = raw.replace(/,/g, "").match(/[\d.]+/);
    return match ? Number(match[0]) : null;
  }

  /**
   * ISBN is printed as visible text on all three marketplaces' book detail
   * pages, in slightly different layouts (a spec row, a metadata list, a
   * plain label). Rather than one brittle selector per site, this scans
   * the already-rendered page's own text for the standard "ISBN[-13/-10]:"
   * label and returns the digits that follow — still a read of what's on
   * screen at the moment of the click, nothing fetched or guessed. Returns
   * null (never a fabricated value) if the label isn't present.
   */
  function extractIsbn() {
    const bodyText = document.body.innerText || "";
    const match = bodyText.match(/ISBN(?:-13|-10)?\s*[:\-]?\s*([0-9][0-9 \-]{8,16}[0-9Xx])/i);
    if (!match) return null;
    return match[1].replace(/[\s-]/g, "");
  }

  /**
   * Same generic label-scan approach as ISBN — "Publication date" (or
   * "Published"/"Publish Date") followed by whatever text follows it, up
   * to the next line break. Kept as raw text rather than force-parsed
   * into a strict date, since marketplaces format this inconsistently
   * and guessing a parse would risk a fabricated precision the page
   * never actually stated.
   */
  function extractPublishedDate() {
    const bodyText = document.body.innerText || "";
    // Matches "Publication date:", "Publish Date:", and the bare "Published:" form
    // (which has no literal "date" token at all) — the (?![a-zA-Z]) guard requires
    // "Publish"/"Published"/"Publication" to end a word right there, so this can't
    // misfire on "Publisher:" or "Publishing House", which share the same prefix.
    const match = bodyText.match(/Publi(?:cation|sh(?:ed)?)(?![a-zA-Z])\s*(?:[Dd]ate)?\s*[:\-]?\s*([^\n]{4,40})/);
    return match ? match[1].trim() : null;
  }

  /**
   * Amazon's own "Best Sellers Rank" line, e.g. "#12,483 in Books (See
   * Top 100) ... #7 in Photography Textbooks". Only implemented for
   * Amazon — Kobo and Google Play Books don't publish an equivalent
   * public ranking, so their extractors correctly return null for both
   * fields rather than inventing one. If the label isn't present (e.g.
   * unranked or region variance), both fields are null, never guessed.
   */
  function extractAmazonRank() {
    const bodyText = document.body.innerText || "";
    const idx = bodyText.search(/Best Sellers Rank/i);
    if (idx === -1) return { bsr: null, category_rank: null, category_rank_label: null };
    const snippet = bodyText.slice(idx, idx + 400);
    const matches = [...snippet.matchAll(/#([\d,]+)\s+in\s+([A-Za-z][A-Za-z &'/-]{2,60})/g)];
    if (matches.length === 0) return { bsr: null, category_rank: null, category_rank_label: null };
    const bsr = Number(matches[0][1].replace(/,/g, "")) || null;
    if (matches.length < 2) return { bsr, category_rank: null, category_rank_label: null };
    const categoryRank = Number(matches[1][1].replace(/,/g, "")) || null;
    return { bsr, category_rank: categoryRank, category_rank_label: matches[1][2].trim() };
  }

  function extractAmazon() {
    const asinMatch = window.location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    const priceText = text([
      ".a-price .a-offscreen",
      "#kindle-price",
      "#price",
      ".a-price-whole",
    ]);
    const price = priceText ? Number(priceText.replace(/[^0-9.]/g, "")) || null : null;
    const category = text(["#wayfinding-breadcrumbs_feature_div", ".a-breadcrumb"]);
    const rank = extractAmazonRank();

    return {
      marketplace: "amazon",
      title: text(["#productTitle", "span#title", "h1#title"]),
      author: text(["#bylineInfo", ".author a", ".contributorNameID"]),
      external_id: asinMatch ? asinMatch[1] : null,
      price,
      currency: priceText?.includes("$") ? "USD" : null,
      category,
      rating: num([".a-icon-alt", "#acrPopover .a-icon-alt"]),
      review_count: num(["#acrCustomerReviewText"]),
      isbn: extractIsbn(),
      published_date: extractPublishedDate(),
      bsr: rank.bsr,
      category_rank: rank.category_rank,
      raw_fields: {
        breadcrumbs: category,
        format: text(["#formats .a-button-selected .a-button-text", "#tmm-grid-swatch-DEFAULT .slot-title"]),
        category_rank_label: rank.category_rank_label,
      },
    };
  }

  function extractGooglePlayBooks() {
    const idMatch = window.location.pathname.match(/\/store\/books\/details\/[^/]*-?([A-Za-z0-9_-]{12,})$/) || window.location.search.match(/[?&]id=([A-Za-z0-9_-]+)/);
    const priceText = text(["meta[itemprop='price']", ".VfPpkd-vQzf8d", "[data-item-id] .price"]);

    return {
      marketplace: "google_play_books",
      title: text(["h1[itemprop='name']", "h1", "[data-item-id] h1"]),
      author: text(["a[href*='/store/books/author']", ".author"]),
      external_id: idMatch ? idMatch[1] : null,
      price: priceText ? Number(priceText.replace(/[^0-9.]/g, "")) || null : null,
      currency: null,
      category: text(["a[href*='/store/books/collection/promotion']", ".category"]),
      rating: num(["div[aria-label*='star']", ".rating"]),
      review_count: num([".review-count"]),
      isbn: extractIsbn(),
      published_date: extractPublishedDate(),
      bsr: null,
      category_rank: null,
      raw_fields: {},
    };
  }

  function extractKobo() {
    const priceText = text([".price-value", ".kobo-price", "[itemprop='price']"]);

    return {
      marketplace: "kobo",
      title: text(["h1[data-testid='title']", "h1.title", "h1"]),
      author: text([".contributor-name", "a[href*='/author/']"]),
      external_id: window.location.pathname.split("/").filter(Boolean).pop() || null,
      price: priceText ? Number(priceText.replace(/[^0-9.]/g, "")) || null : null,
      currency: null,
      category: text([".category-links a", ".breadcrumbs"]),
      rating: num([".rating-star-container", "[itemprop='ratingValue']"]),
      review_count: num([".reviews-count"]),
      isbn: extractIsbn(),
      published_date: extractPublishedDate(),
      bsr: null,
      category_rank: null,
      raw_fields: {},
    };
  }

  const host = window.location.hostname;
  let result;
  if (host.includes("amazon.")) result = extractAmazon();
  else if (host.includes("play.google.com")) result = extractGooglePlayBooks();
  else if (host.includes("kobo.com")) result = extractKobo();
  else return { error: "Unsupported page — InkframeScout only works on Amazon, Google Play Books, and Kobo book pages." };

  if (!result.title) {
    return { error: "Could not identify a book on this page. Make sure you're on a single book's product page, not a search or category page." };
  }

  return {
    ...result,
    source_url: window.location.href,
    extension_version: EXTENSION_VERSION,
    adapter_version: ADAPTER_VERSIONS[result.marketplace],
  };
})();
