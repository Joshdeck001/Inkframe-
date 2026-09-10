# InkframeScout

A real, installable browser extension — not a mockup, not a demo. It does
**one thing**: when you're looking at a single book's page on Amazon,
Google Play Books, or Kobo, and you click "Capture Evidence," it reads the
publicly visible information on that page (title, author, price,
category, rating, and platform-specific identifiers) and sends it to your
own InkFrame account as one research clip.

## What this deliberately does NOT do — and why

An earlier version of this spec asked for automatic background scanning:
detect every book on a search-results or best-seller page as you scroll,
inject an intelligence panel onto each one, and continuously sync
observations without further input. That was not built, on purpose.

Amazon's Conditions of Use (and the equivalent terms on most marketplaces)
prohibit automated data mining, robots, and similar data-gathering tools
against their sites — a prohibition that applies to the *act* of automated,
systematic extraction, not just to bypassing login/CAPTCHA/authentication.
A content script that auto-parses every visible book on every page a user
browses, and syncs that continuously to a third-party server, is exactly
that category of tool regardless of which human's browser it runs in.

InkframeScout instead requires one deliberate click per book, on one page
at a time, with nothing running in the background and nothing injected
into the host page's UI. It reads only what's already rendered at the
moment of that click — no auto-scrolling, no auto-expanding sections, no
repeated re-scanning. This is a meaningfully different, and defensible,
category of tool: closer to a personal clipping/bookmarking action than to
a scraper. If InkFrame ever adds an officially supported marketplace data
API, that would be the right way to go further than this.

A second, larger spec later asked for the same automatic/continuous
scanning again (an "Automatic Detection" toggle, "Scan This Page" for
every book on a results page) plus a BSR-history/Intelligence-Score
analytics layer on top. That mechanism was declined again, for the same
reason. What *was* added on top of the one-click model: optional **Market
Snapshots** to group clips from one comparison session, ISBN extraction
(read off the already-rendered page, same as every other field) for real
cross-platform book matching, and observed price history built only from
the user's own repeated clips over time — see "InkframeScout v2" in the
root `README.md`.

A third spec ("Intelligence 2.0") asked for the same automatic overlay
mechanism a third time — declined again, same reasoning — plus a large
set of genuinely new analysis and workspace features that *were* built:
BSR/category rank/publication date extraction (same click, same
read-only rule as every other field), Competition Sets, a Watchlist,
Market Scanner, and an Opportunity Workspace. See "InkframeScout
Intelligence 2.0" in the root `README.md` for the full list of what was
built versus declined, and why.

Two small additions to the popup itself, both still scoped to the single
user-click model: **Pause**, settable from Settings, makes the server
reject new observations from this connection without revoking it (the
popup shows "Collection is paused" and disables clipping); and an
**offline retry queue** — if delivering an already-captured clip to
InkFrame's API fails (a network error), the extracted JSON is queued in
`chrome.storage.local` and retried the next time the popup opens. Neither
touches a marketplace page; both only govern whether/when a capture the
user already explicitly made gets delivered.

A fourth spec ("v3 — Evidence-First Market Intelligence Expansion")
reframed the extension as an evidence-capture tool rather than a
scraper, and explicitly asked to preserve every v2 decision above rather
than revisit them — confirmed still true, with regression tests to
prove it. What v3 added: **publisher** extraction (same label-scan
approach as ISBN/BSR/date), **Capture Selection** (reads only text
already highlighted on the page, one inline call, still one click), and
relabeled the primary button "Capture Evidence" (was "Clip This Book").
See "InkframeScout v3" in the root `README.md`.

## Architecture

```
extension/
  manifest.json        Manifest V3, minimal permissions (activeTab, storage, scripting)
  background/           Thin service worker — no persistent scanning, nothing to poll
  content/extract.js     Injected ONCE per click via chrome.scripting.executeScript,
                          never a persistent content_scripts entry
  popup/                Connection setup, status, and the "Capture Evidence" button
  icons/                 Blue + black brand icons
```

No `content_scripts` are registered in the manifest at all — `extract.js`
only ever runs when `popup.js` explicitly injects it after the user clicks
the button, using the `activeTab` permission Chrome grants for that one
user-gesture-triggered call. Nothing in this extension can read or act on
a page the user hasn't just deliberately asked it to.

## Installing (not published to a web store yet)

Easiest path — download a ready-made zip straight from InkFrame itself: **InkFrame → Settings → Extensions →
InkframeScout → Download InkframeScout Extension**. That zip (`public/downloads/inkframescout-extension.zip`) is
generated automatically from this exact folder every time the app builds or starts (`scripts/build-extension-zip.ts`,
wired to `predev`/`prebuild` in `package.json`) — it's never committed, so it can never go stale relative to the
real source below.

1. Download and unzip it (browsers only ever download single files, never a folder directly — the zip is the
   standard way around that). Find the `extension` folder inside — it directly contains `manifest.json`.
2. Open `chrome://extensions` (or your browser's equivalent).
3. Enable **Developer mode**.
4. Click **Load unpacked** and select that `extension` folder — this folder, if you're working from the repo
   directly instead.
5. In InkFrame, go to **Settings → Extensions → InkframeScout** and click
   **Generate Connection Code**.
6. Open the extension's popup, enter your InkFrame URL and paste the code,
   then click **Connect**.

## Data flow

```
User clicks "Clip This Book"
        ↓
extract.js reads the currently-rendered page once
        ↓
popup.js POSTs the result to /api/inkframescout/observations
        ↓
Server resolves the owning user from the bearer token (never a
client-supplied user id) and stores it as one scout_clips row
        ↓
User reviews it in InkFrame Research → "My Clips" and assigns it to a
research session (or discards it) — only then does it become real
evidence in competitor_research, tagged source_type: 'browser_clip'
```

## Privacy

InkframeScout never collects marketplace passwords, payment information,
or authentication tokens, never bypasses CAPTCHA/MFA/login, and never
reads pages outside the three supported marketplaces. Nothing is
aggregated across other InkFrame accounts — a clip is private to the
account that captured it until that account's own owner assigns it into
their own research.
