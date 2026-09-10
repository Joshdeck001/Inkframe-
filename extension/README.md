# InkframeScout

A real, installable browser extension — not a mockup, not a demo. It does
**one thing**: when you're looking at a single book's page on Amazon,
Google Play Books, or Kobo, and you click "Clip This Book," it reads the
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

## Architecture

```
extension/
  manifest.json        Manifest V3, minimal permissions (activeTab, storage, scripting)
  background/           Thin service worker — no persistent scanning, nothing to poll
  content/extract.js     Injected ONCE per click via chrome.scripting.executeScript,
                          never a persistent content_scripts entry
  popup/                Connection setup, status, and the "Clip This Book" button
  icons/                 Blue + black brand icons
```

No `content_scripts` are registered in the manifest at all — `extract.js`
only ever runs when `popup.js` explicitly injects it after the user clicks
the button, using the `activeTab` permission Chrome grants for that one
user-gesture-triggered call. Nothing in this extension can read or act on
a page the user hasn't just deliberately asked it to.

## Installing (not published to a web store yet)

1. Open `chrome://extensions` (or your browser's equivalent).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this `extension/` folder.
4. In InkFrame, go to **Settings → Extensions → InkframeScout** and click
   **Generate Connection Code**.
5. Open the extension's popup, enter your InkFrame URL and paste the code,
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
