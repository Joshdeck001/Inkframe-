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
      raw_fields: {
        breadcrumbs: category,
        format: text(["#formats .a-button-selected .a-button-text", "#tmm-grid-swatch-DEFAULT .slot-title"]),
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

  return { ...result, source_url: window.location.href };
})();
