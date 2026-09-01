# InkFrame

AI-powered book writing and publishing platform. Next.js (App Router) +
Supabase + Anthropic.

## Status

Steps 1-15 of the build plan are done:

1. **Project setup** — the 5 approved pages (`index`, `auth`, `dashboard`,
   `new-book-wizard`, `job-progress`) are ported into Next.js routes with
   their exact markup/CSS preserved, plus `translate`/`publish`/`advertising`
   which were also supplied. See `content/*.ts` for the raw markup/CSS pulled
   from each original file and `lib/LegacyPage.tsx` for the pages that still
   render it as-is (translate, publish, advertising, the landing page).
   `auth`, `dashboard`, `wizard`, and `job-progress` have since been rewritten
   as real React components (see below) — same visual output, real state.
2. **Supabase schema** — every table from
   `InkFrame_Project_Record_Schema.md` with row-level security, in
   `supabase/migrations/`. See `supabase/README.md` for how to apply it.
3. **Real auth** — `/auth` calls Supabase Auth (email/password) for both
   sign-in and sign-up; protected routes redirect to `/auth` via `proxy.ts`
   (Next's middleware).
4. **Real project creation** — the wizard writes to `projects` and its
   related tables instead of `localStorage`.
5. **Book Blueprint generation** — `/api/blueprint` calls Claude
   (server-side only) to produce Parts → Chapters with an
   Approve/Edit/Regenerate review screen (wizard Step 9). Nothing moves past
   that screen until the user approves.

6. **Autonomous Writing Agent** — `/api/cron/writing-agent`, triggered on a
   schedule by Vercel Cron (`vercel.json`), advances exactly one chapter per
   invocation for the single least-recently-touched `QUEUED`/`WRITING`
   project: seeds `chapters` from the approved blueprint on first run, drafts
   the next pending chapter with Claude (continuity MVP: passes the tail of
   the previous chapter as context — the fuller story_bible-driven
   Continuity Engine lands once the Fiction/Outline/Web-Fic prompt specs are
   available), and updates `chapters`/`project_scope.words_written`. This
   runs server-side on a cron schedule, not tied to any open browser tab —
   `job-progress` just polls every 8s to reflect real progress while
   watching, and works exactly the same if you close the tab.
   Requires `CRON_SECRET` (see `.env.local.example`) — Vercel sends it
   automatically once that env var exists in the project. For local testing
   without Vercel Cron, trigger a tick manually:
   `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/writing-agent`

7. **Quality Loop** — `/api/cron/quality-loop`, same cron pattern, scores
   the next `written` chapter of the single least-recently-touched
   `REVIEWING` project against `chapters.quality_score`'s ten dimensions
   (structure, continuity, readability, instruction_adherence, repetition,
   pacing, factual_consistency, character_consistency, platform_suitability,
   completeness — internal assessment only, never shown as a scientific
   guarantee). Below-threshold chapters get one automatic revision pass
   (`chapters.revision_count`, bounded so it can never loop forever) and are
   then approved either way. Once every chapter in a project is `approved`,
   status moves to `READY_FOR_REVIEW`.

   `job-progress`'s 8-step pipeline only ever marks Blueprint/Writing/Quality
   as done or active — Research/Cover/Metadata/Compliance/Export stay
   visually pending no matter the project's status, because none of those
   are automated yet (Steps 8-10) and marking them "done" would be exactly
   the kind of fabricated progress the spec explicitly prohibits.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # fill in the 4 keys, see below
npm run dev
```

Then follow `supabase/README.md` to create the tables in your Supabase
project before signing up — the app will run, but any Supabase call will
fail until the schema exists.

### Where the 4 keys go

All in `.env.local` (gitignored, never committed) — see
`.env.local.example` for the exact variable names:

- **Supabase URL + anon key** — Project Settings → API in your Supabase
  dashboard.
- **Supabase service-role key** — same page. Server-only, never sent to the
  browser; not required for Steps 1-5, reserved for privileged
  server-side operations later (e.g. the Admin Panel).
- **Anthropic API key** — required now, for Book Blueprint generation.
- **OpenAI / Gemini keys** — not used yet; wired in as the Writing Agent's
  model-routing options are built (Step 6+).

8. **Research Department + Title/Metadata Risk Check** — moving from wizard
   Step 7 to Step 8 now saves the project (if it hasn't been already) and
   calls `/api/research`, which flags real title risk
   (`title_risk_checks` — status is always a risk flag like `no_issue` /
   `potential_conflict`, never "100% safe" or "guaranteed clear") and
   researches the book's category for what's already common and how this
   book could differentiate (`research_notes`, types `title-risk` and
   `genre`). This is AI-knowledge-based research, not a live scrape of
   Amazon/GoodNovel/Meganovel — the summary says so rather than implying
   verified live market data.

9. **Cover, Metadata, Compliance, and Formatting Departments** — once
   every chapter is quality-approved, four more cron routes run in the same
   sequence job-progress's pipeline icons already show them in (Cover →
   Metadata → Compliance → Export), each reading the same project record:
   - `/api/cron/cover-department` drafts 3 cover concepts as
     image-generation *prompts* (`cover_department.concepts`) — actually
     rendering artwork needs an image API key that isn't wired in yet, and
     the UI says so rather than implying a real image exists.
   - `/api/cron/metadata-department` writes real description/keywords(7,
     <=50 chars each)/categories to `metadata_department`.
   - `/api/cron/compliance-department` runs **deterministic** checks (no
     LLM call) against the `platform_profiles` rules already seeded in
     Step 2 — keyword count/length, repeated title words, AI-disclosure
     (every InkFrame manuscript is AI-generated, so this is always flagged
     action_required), the latest title-risk result, and chapter-length
     guidance for serial platforms — into `compliance_checks`.
   - `/api/cron/formatting-department` assembles every approved chapter
     into a real `.docx` file (the `docx` npm package) and uploads it to a
     new private Supabase Storage bucket (`supabase/migrations/0003_storage.sql`).
     `/api/export-download` hands back a 60-second signed URL after
     verifying the requester owns the project — there's no direct client
     read access to the bucket. Only `docx` is produced; EPUB/PDF aren't
     implemented, and `formatting_jobs.output_formats` only ever lists
     what was actually generated.

   Once formatting finishes, status reaches `READY_FOR_REVIEW` and
   `job-progress` shows the real metadata, cover concept prompts, and
   compliance results inline, plus a working "Download Manuscript (DOCX)"
   button.

10. **Final Quality Gate** — folded into the Formatting Department's tick
    (it's the last of the Step 9 departments to run, right before
    `READY_FOR_REVIEW`), `computeQualityGate` in `lib/quality-gate.ts` is a
    deterministic summary of what Steps 5-9 already produced — content,
    structure, continuity (currently just checks chapter numbering has no
    gaps — the real story_bible-driven Continuity Engine isn't built),
    word count, images, metadata, platform, formatting, and cover checks,
    plus an `overall_readiness_score` (0-100, explicitly an internal
    assessment, never a platform-acceptance guarantee). `publish.html`'s
    checklist now reads this real data instead of seven hardcoded "✓
    Ready" rows — where InkFrame genuinely doesn't have something yet
    (paperback interior/cover PDFs, pricing), it says so rather than
    faking a checkmark. The platform-picker/prepared-fields/"I've
    Published This" flow below the checklist is still the original static
    demo — that's Step 13 (Publishing Engine), not this step.

13. **Publishing Engine** — the rest of `publish.html` (below the Step 10
    checklist) is now real too, and fully converted to React (no more
    injected vanilla script): **Approve & Continue** sets
    `projects.status = USER_APPROVED` and logs it to `publishing_log`;
    picking a platform card creates/updates a `publishing_jobs` row
    (unique per project+platform — `0004_publishing_jobs_unique.sql`) with
    real `prepared_fields` (title, description, all 7 keywords, top
    category — all pulled from `metadata_department`; price is a simple
    word-count-tier suggestion, clearly labeled a suggestion, never
    auto-set) and moves the project to `READY_FOR_EXPORT`; the Copy
    buttons and platform bookshelf link work for real. **I've Published
    This** sets `publishing_jobs.status = user_marked_published`,
    `projects.status = EXPORTED`, and logs the event. InkFrame still never
    logs into or submits to any platform itself — this is the
    prepare-and-handoff flow exactly as specced, just with real data
    instead of the static demo.

12. **Translation Department** — `translate.html` is fully real: "Select
    recent project" queries your actual projects; "Upload manuscript"
    uploads straight to a new private `uploads` bucket
    (`0005_uploads_bucket.sql`, with real client-side RLS this time —
    unlike `exports`, the browser uploads directly here, so it needs
    owner-scoped insert/select/delete policies keyed off the
    `{user_id}/...` path prefix). Starting a job writes a real
    `translation_jobs` row.

    `/api/cron/translation-department` (same cron pattern) advances one
    unit of work per tick — one chapter for an existing project, or one
    ~2500-word chunk of an uploaded manuscript — translating title/
    subtitle/description first, then the body, then assembling a real
    `.docx` per language once every unit is done (uploaded PDF/EPUB
    aren't supported yet — only DOCX text extraction is implemented, via
    `mammoth`; those jobs mark `failed` honestly instead of hanging).
    `/api/translation-download` hands back a signed URL the same way
    `/api/export-download` does. There's no dedicated "my translations"
    results page yet since none was in the approved mockups — the pipeline
    is fully real and reachable by API, just not surfaced in the dashboard
    UI yet.

15. **Advertising Department** — `advertising.html` is real now (the
    Overview tab's actual content; the other five tabs were always
    decorative labels in the approved page, no change there). The stat
    grid computes real totals from `advertising_metrics` — `lib/advertising-metrics.ts`
    centralizes the zero/null-safe ACOS/ROAS math the schema requires
    ("Not available" when nothing's been imported, "Cannot be calculated
    from available data" instead of NaN/Infinity, never a zero-filled
    guess). "Advertise a Book" opens a picker over your projects; picking
    one calls `/api/advertising/generate`, which pulls the project's own
    title/description/metadata (never re-asks) and asks Claude for a
    keyword list across all six groups plus one starter campaign — saved
    to `advertising_projects`/`advertising_campaigns`/`advertising_keywords`,
    plus a budget suggestion as an `advertising_recommendations` row
    (`daily_budget` itself stays null — a suggestion, never auto-set).
    "Import Ad Data" parses a real CSV into `advertising_metrics`
    (`source: csv_import`). Nothing here ever logs into or touches a real
    Amazon Advertising account.

14. **AI Copilot — real backend** — the dashboard's Copilot widget now
    talks to `/api/copilot/message` instead of a canned `setTimeout` reply.

    - **Voice I/O is browser-native** — the Web Speech API
      (`SpeechRecognition`/`webkitSpeechRecognition` for input,
      `SpeechSynthesis` for output). No new API key, and the browser's own
      native permission prompt handles microphone access the first time you
      talk to it. Unsupported browsers (Firefox, Safari as of this writing)
      fall back to a text prompt instead of breaking.
    - Every message is saved to `copilot_sessions`/`copilot_messages` (one
      session per project — `0006_copilot_session_unique.sql`), so reopening
      the widget loads the real conversation history instead of resetting.
    - The backend classifies each message with Claude (forced tool call)
      into `status_query`, `pause_production`, `resume_production`,
      `revise_chapter`, or `general_question`, using *only* the project's
      real current facts (chapter statuses, words written, quality gate
      score, compliance check results, formatting job status) — it never
      invents progress or numbers that aren't in the database.
    - **MUTE and PAUSE PRODUCTION remain fully independent controls, as
      required.** Mute only stops speech capture/output
      (`copilotMuted`, local UI state) — it never touches production. Pause
      writes `copilot_sessions.production_paused = true` for real, and every
      department cron tick (Writing Agent, Quality Loop, Cover, Metadata,
      Compliance, Formatting — `lib/production-paused.ts`) now filters out
      paused projects, so "Pause Production" genuinely stops background work
      instead of just changing a label. The Pause/Resume button itself calls
      the API directly (`action: "pause"`/`"resume"`) rather than routing
      through the LLM, so it's instant and never depends on the model
      classifying the click correctly.
    - "Revise this chapter" is a real action too: it only fires if the named
      chapter exists and has already finished its first pass (`approved`),
      sends it back through the Quality Loop (`chapters.status = 'written'`,
      `projects.status = 'REVIEWING'`), and says plainly when it can't act
      (chapter not found, still mid-draft, or the book's already exported)
      instead of pretending it did something it didn't.
    - InkFrame still never claims to submit anything to a publishing or
      advertising platform through the Copilot — same prepare-and-handoff
      rule as everywhere else in the app.

11. **Admin Panel** — `/admin`, gated by `profiles.role === 'admin'` (there's no
    sidebar link for it, same as the promote-yourself instructions in
    `supabase/README.md` — go there directly once you're an admin). It has
    no approved mockup, so it reuses the same shared design system as the
    other unmocked pages (`content/shared-secondary.css.ts`, extended with
    tabs/textarea/select/table styling — same tokens, no new visual
    language) rather than inventing a new one. Four tabs, all backed by real
    tables:

    - **Site Content** — full CRUD on `site_content` (the landing/auth/
      dashboard/wizard/job-progress CMS fields), filterable by page. A
      `locked` row is genuinely uneditable in the UI (its Save/Delete
      buttons are disabled) — the same rule the database's own RLS policies
      already enforce (`not locked and ... role = 'admin'`), so nothing here
      can bypass what the schema already guarantees.
    - **Platform Profiles** — edit KDP/GoodNovel/Meganovel (or add a new
      platform), including the six JSON rule fields
      (`submission_requirements`, `content_rules`, `metadata_rules`,
      `formatting_rules`, `image_rules`, `contract_submission_rules`) as
      validated JSON textareas — a save is rejected with an inline error
      before it ever reaches the database if the JSON doesn't parse.
    - **Genre Taxonomy** — add/edit genres per platform, including parent
      genre and the trope add-on JSON content, same validate-before-save
      pattern.
    - **Users** — read-only, via `/api/admin/users` (server route, checks
      the caller is an admin, then uses the service-role client's
      `auth.admin.listUsers()` — the only way to list users at all, since
      `auth.users` isn't reachable from the browser). Shows email, role,
      join date, and real project count. **No role editor anywhere** — the
      schema's own comment on `profiles.role` says role changes are
      deliberately not exposed through the app's API, only from the
      Supabase dashboard directly, and the Admin Panel honors that.

## Deploying on Vercel's free (Hobby) plan

Hobby caps cron jobs at 2, running at most once a day, and function
duration at ~60s. The 7 department cron routes now run as one consolidated
job (`/api/cron/all`, scheduled daily in `vercel.json`) instead of 7
separate 5-minute jobs — `lib/run-all-departments.ts` runs each
department's tick in sequence within a time budget. Every route's
`maxDuration` is capped at 60. The individual `/api/cron/<name>` routes
still exist and work the same way (same `Bearer $CRON_SECRET` auth) — call
them directly for local testing, or register them individually in
`vercel.json` instead of `/api/cron/all` if the project moves to a plan
without Hobby's cron limits, for much faster (every-5-minutes) progress.

## How to Upgrade to Vercel Pro Later

You can change how much work InkFrame does in the background yourself,
any time, without editing any code and without needing Claude Code or a
developer. Here's exactly how.

**The setting:** an environment variable named `PLAN_TIER`.

**The values it accepts:** the word `free` or the word `pro`. (If you
don't set it at all, it behaves as `free`.)

**Where to change it:**
1. Go to your project on vercel.com.
2. Click **Settings**.
3. Click **Environment Variables** in the left-hand list.
4. Find `PLAN_TIER` (or add it, if it isn't there yet) and set its value
   to `free` or `pro`.
5. Save it.

**Then redeploy — this part is required, the setting won't take effect
until you do:**
1. Click **Deployments** at the top of the page.
2. Click the three dots (**⋯**) next to the most recent deployment.
3. Click **Redeploy**.
4. Wait for it to finish (usually a couple of minutes) — after that, the
   new setting is live.

**What actually changes between `free` and `pro`:**

- **Chapters per run:** Every so often, InkFrame's background system
  wakes up and does a round of work — writing the next chapter, checking
  quality, updating the cover/description/etc. On `free`, it does **one**
  round of that work each time it wakes up. On `pro`, it does **up to
  eight** rounds back-to-back each time it wakes up — so books move
  through the pipeline roughly eight times faster, chapter for chapter.

- **How often it wakes up:** This is the one part `PLAN_TIER` does **not**
  change, and it's worth being upfront about why: Vercel's free plan only
  allows background jobs to wake up **once per day**, and that's a rule
  set by Vercel itself, not something a setting inside the app can
  override — no environment variable can make Vercel's free plan check in
  more often than once a day. So on `free`, once a day InkFrame does 1
  round of work; on `pro`, once a day it does up to 8 rounds of work in a
  row. Either way, it's still just once a day *waking up* — `pro` makes
  each wake-up do much more, not happen more often.

  If you want it checking in more often than once a day (not just doing
  more per check-in), there are two ways to get that, for later:
  - If you upgrade your actual Vercel account to a paid plan, that
    removes the once-a-day limit — but making InkFrame use a shorter
    interval still means editing one line in a file called
    `vercel.json`, which is a small code change (the one thing on this
    list that isn't just a dashboard setting).
  - Or, at any time, on any Vercel plan, free included: use a free
    third-party scheduling website (for example cron-job.org) to "ping"
    InkFrame as often as you like. No code, no Vercel plan change — you'd
    just enter InkFrame's web address in that website's own dashboard and
    tell it how often to visit. Ask if you want help setting this up when
    the time comes.

**Tested and confirmed working both ways** before this was written —
`free` runs exactly 1 round per wake-up, `pro` runs up to 8 (and
sensibly stops early once there's nothing left to do, or if it's running
low on time for that turn). Run `npm run test:plan-tier` any time to
re-check this yourself — it doesn't need your Vercel site or database to
be running, it checks the on/off logic directly.

## Dashboard sidebar — every item now goes somewhere

The dashboard's sidebar originally had 11 nav items and a notification
bell with no click behavior at all (true of the original approved design
too — no mockup ever existed for these). All of them now go somewhere
real, reusing the same visual language as the 8 approved pages
(`content/shared-secondary.css.ts`):

- **My Books** (`/books`), **Cover Designer** (`/cover`), **Formatter**
  (`/formatter`), **Research** (`/research`), **Metadata** (`/metadata`),
  **Compliance Check** (`/compliance`) — real data per project
  (`lib/useMyProjects.ts` + `lib/ProjectPicker.tsx` are shared across the
  project-scoped ones).
- **Settings** (`/settings`) — real name/password changes, sign out.
- **Help & Support** (`/help`) — static FAQ.
- **Templates** and **Images** — honestly labeled "not built yet" rather
  than faked, since no template system or image-generation backend
  exists.
- **AI Writing Agent** routes to `/job-progress` for whichever project is
  actually active.
- The **notification bell** is a real dropdown computed from actual
  project status — no fabricated count.

## What's next

All 15 steps of the original build plan are done. What's left is mostly
things that need a real account to verify (confirm the Admin Panel and AI
Copilot behave as expected against your live Supabase project) or genuine
product decisions rather than more scaffolding — e.g. wiring an actual
image-generation API for the Cover Department, or building the Templates
feature that's currently honestly labeled "not built yet." See the roadmap
in `InkFrame_Opening_ClaudeCode_Prompt.md` for anything not covered above.
