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
duration at ~60s. The 7 department cron routes run as one consolidated job
(`/api/cron/all`) instead of 7 separate ones — `lib/run-all-departments.ts`
runs each department's tick in sequence within a time budget. Every
route's `maxDuration` is capped at 60. The individual `/api/cron/<name>`
routes still exist and work the same way (same `Bearer $CRON_SECRET`
auth) — call them directly for local testing.

**This project is currently on Vercel's Hobby plan**, so
`vercel.json`'s schedule for `/api/cron/all` is `"0 6 * * *"` — once a
day, the most Hobby allows. A schedule shorter than that (e.g. every 5
minutes, which this project briefly had) makes Vercel silently reject
every deployment that includes it — the site just keeps serving
whatever was last built successfully, with no obvious error shown
anywhere, which is exactly what happened here and cost real time to
track down. If this project is ever upgraded to Vercel Pro, `PLAN_TIER`
alone won't make it check in more often (see the next section) — that
schedule string is the one genuine code change needed, and only then.

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
  change — it's controlled entirely by the `schedule` string in
  `vercel.json`, which Vercel evaluates against the account's real plan.
  On Vercel's free Hobby plan (what this project is on right now) this
  can be at most once a day, and that's a hard limit — a shorter
  schedule doesn't just get "slowed down" to once a day, it makes Vercel
  reject the deployment outright, silently, with no error visible unless
  you go looking at the Deployments list yourself. If you upgrade the
  actual Vercel account to Pro later, making InkFrame check in more
  often needs one small edit to that `schedule` string in `vercel.json`
  — a genuine code change, the one thing on this list that isn't just a
  dashboard setting. Ask when you're ready to upgrade and I'll make that
  edit.

  Right now, on Hobby, if you want it checking in more often than once a
  day without touching Vercel's plan at all: a free third-party
  scheduling website (e.g. cron-job.org) can "ping"
  `POST/GET https://<your-domain>/api/cron/all` with header
  `Authorization: Bearer <CRON_SECRET>` as often as you like, configured
  entirely in that website's own dashboard, zero code changes. Ask if you
  want help setting that up.

**Tested and confirmed working both ways** before this was written —
`free` runs exactly 1 round per wake-up, `pro` runs up to 8 (and
sensibly stops early once there's nothing left to do, or if it's running
low on time for that turn). Run `npm run test:plan-tier` any time to
re-check this yourself — it doesn't need your Vercel site or database to
be running, it checks the on/off logic directly.

## Admin approval for new sign-ups

Signing up no longer means you're in. Every new account starts as
`profiles.approval_status = 'pending'` (migration
`0007_account_approval.sql`) and can't reach a single protected page or
API route until an admin approves it — this was the biggest real gap in
the project before: anyone who found the sign-up page could create an
account and immediately start burning real Anthropic API spend, with no
gate at all. Now:

- **Page-level gate** — `lib/supabase/middleware.ts` checks
  `approval_status` on every protected-route request (same place the
  signed-in check already lived) and redirects anyone who isn't
  `'approved'` to `/pending-approval`, a small honest waiting-room page
  ("an admin needs to approve your account") with a **Check Again** button
  and **Sign Out**.
- **API-level gate, not just the page redirect** — a valid session cookie
  would otherwise still let a pending account call an API route directly,
  bypassing the page gate entirely. `lib/require-approved-user.ts` is the
  same check, dropped into every route that costs money or touches real
  data: `/api/blueprint`, `/api/research`, `/api/advertising/generate`,
  `/api/export-download`, `/api/translation-download`, and both handlers
  of `/api/copilot/message`.
- **Fails closed** — both checks treat a missing or unreadable profile row
  as "not approved," never as "let them through."
- **Existing accounts are grandfathered in.** The migration sets
  `approval_status = 'approved'` for every row that already exists at the
  moment it runs, so applying it to your live project never locks out
  people who were already using the app — only sign-ups from that point
  on start `'pending'`. See the updated bootstrap SQL in
  `supabase/README.md` — promoting yourself to admin now sets
  `approval_status = 'approved'` in the same statement, since otherwise
  you'd promote yourself to admin while still being gated out yourself
  with no other admin around to approve you.
- **Approving people happens in the Admin Panel's Users tab** (`/admin`) —
  pending accounts sort to the top, with **Approve**/**Reject** buttons.
  Both call a single Postgres function, `admin_set_approval()`
  (`security definer`, checks the caller is an admin internally via
  `auth.uid()`), rather than a broad `UPDATE` policy on `profiles` — kept
  deliberately narrow so it can never be used to change `role` too. Role
  changes stay exactly as impossible through the app as before this
  change; this only ever touches `approval_status`.

## Three AI providers, one fallback chain

Every AI call in the app — the Writing Agent drafting a chapter, the
Quality Loop scoring and revising one, Cover concepts, Metadata, Research,
Advertising strategy, and the AI Copilot's replies — goes through
`lib/ai-client.ts` instead of calling Anthropic directly. It tries
**Anthropic (Claude) first, then OpenAI, then Gemini**, automatically
falling through to the next one if a provider errors — rate-limited, out
of credit, briefly down, whatever the reason — so one vendor having a bad
moment doesn't stop the whole pipeline. A provider is skipped entirely if
its API key isn't set; the app still runs fine with just one key
configured, same as before.

- **Real fallback, not a simulation** — verified live against this
  project's actual keys: Anthropic genuinely failing (see the note below)
  and OpenAI genuinely unreachable from this sandbox both correctly fell
  through to Gemini, which answered correctly, including with one of the
  actual production tool schemas (Quality Loop's 10-dimension scorer).
- **`model_used` columns now tell the truth.** `chapters.model_used` and
  `translation_jobs.model_used` used to be hardcoded to `"claude-opus-5"`
  regardless of what actually ran. They now record e.g.
  `"gemini:gemini-3.6-flash"` — whichever provider and model genuinely
  produced that content.
- **Provider-format differences are handled once, centrally.** Anthropic
  and OpenAI both accept standard JSON Schema for tool/function
  definitions directly; Gemini's `Schema` type uses uppercase type names
  (`STRING`, not `string`) and stringified `minItems`/`maxItems` —
  `toGeminiSchema()` converts automatically, so every department still
  writes one schema, not three.
- **Model names are configurable**, not hardcoded guesses that go stale —
  `OPENAI_MODEL` / `GEMINI_MODEL` env vars, changeable in Vercel's
  dashboard with no code edit (same pattern as `PLAN_TIER`). The Gemini
  default was corrected once already this way: the model this code
  originally shipped with had already been retired by Google by the time
  it was tested live, and Google's own error message named the exact
  replacement.

**A real, live finding from building this, not a hypothetical:** testing
this against your actual Anthropic key returned "Your credit balance is
too low to access the Anthropic API" — a real account-status error, not a
code bug. Worth checking your Anthropic console's billing page; until
that's resolved, every AI call in production is silently running on
Gemini (or OpenAI, if that key works from Vercel's network) instead of
Claude, invisibly, because that's exactly what the fallback chain is
built to do.

## Real cover-art generation — OpenAI and Gemini working together

The Cover Department used to only ever produce three text prompts — no
actual artwork, ever. It now attempts real images too, through
`lib/image-client.ts`:

- **OpenAI first, then Gemini — never Claude.** Claude has no
  image-generation capability at all, so unlike the text/structured
  fallback chain above, this one is two providers, not three. Each
  provider is skipped if its key isn't set.
- **One image attempt per cron tick, per concept**, same "one unit of work
  per tick" shape as every other department (`lib/cover-department.ts`).
  The first tick after a book's chapters are all quality-approved drafts
  the 3 text concepts (as before); each subsequent tick attempts real
  artwork for the next concept that hasn't been tried yet. Once all 3 have
  been attempted, the project moves on to Metadata — it never blocks on
  image generation succeeding.
- **Bounded retry, never fabricated.** A concept that fails to produce a
  real image (no key, no billing, provider down, whatever) is marked
  attempted and left exactly as it always was — a real, usable prompt with
  no image — instead of being retried forever or having a fake image
  substituted in.
- **Real images upload to a new public `covers` bucket**
  (`0010_covers_bucket.sql`, same public-read pattern as `avatars`) and
  render directly on the Cover Designer page (`/cover`) above their
  prompt once generated.
- **Model names are configurable** — `OPENAI_IMAGE_MODEL` / `GEMINI_IMAGE_MODEL`
  env vars, same pattern as `OPENAI_MODEL`/`GEMINI_MODEL` above.

**A real, live finding from building this, not a hypothetical:** Gemini's
image endpoint (`generateImages()` / Imagen) is deprecated and, per
Google's own error message, only works on Vertex AI/Enterprise now, not a
plain Gemini API key — the code here uses the current working path
(`generateContent()` with `responseModalities: [IMAGE]`) instead. Tested
live against this project's actual Gemini key, the request correctly
resolved to a real model, but failed with `429 RESOURCE_EXHAUSTED` —
**the free tier has a zero quota for image-generation models.** Google
requires billing enabled on the Google Cloud/AI Studio project for image
generation to work at all. OpenAI's image endpoint couldn't be tested live
from this environment (network-blocked), but the same kind of
billing-enabled-account requirement likely applies there too. Until
billing is enabled on at least one of the two, cover concepts will keep
generating as prompt-only text — same as before this feature existed, now
for a documented reason instead of silently.

## Interior/in-manuscript images — the Image Department

The `/images` page and `image_placements` table existed in the original
schema (Step 6) but nothing ever populated them. They now do, through a
new pipeline stage — `GENERATING_IMAGES`, between cover art and metadata —
and `lib/image-department.ts`:

- **Only runs when the wizard's Step 7 asked for it.** "No Images" and
  "I'll upload my own" skip straight through untouched — manual upload
  still isn't built. "Generate automatically" or "Mix of both" only
  trigger real placement + generation when the user also said yes to
  "recommend placements" on that same step; saying no there leaves the
  book to move on with no interior images, same as before this feature
  existed.
- **Placement is a real AI decision, not a fixed rule.** The first tick
  for a project sends the chapter list (number, title, objective) to the
  same 3-provider text fallback as everything else (`lib/ai-client.ts`)
  and asks it which chapters — if any — would genuinely benefit from one
  illustration, where in the chapter, and a concrete image prompt for
  each. It's explicitly fine for it to propose zero; most chapters don't
  need one.
- **Same real-artwork pipeline as covers** — one image attempt per cron
  tick, per placement, through `lib/image-client.ts` (OpenAI then
  Gemini), uploading to a new public `manuscript-images` bucket
  (`0011_interior_images.sql`). A placement that fails to produce a real
  image is marked attempted and left exactly as it's always been — a
  real, usable prompt with no image — same bounded-retry, never-fabricate
  rule as the Cover Department. Needs the same billing-enabled OpenAI or
  Gemini account as cover images do.
- **`/images` now shows real placements and artwork** per book instead of
  the old "not built yet" placeholder — chapter, placement location,
  prompt, and the generated image once one exists.

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
  project-scoped ones). My Books also has a real **Delete** button per book
  (with a confirm dialog) — there was previously no way to remove a project
  once you'd started it, even an abandoned one-chapter draft. Deleting
  really deletes: the row and everything that cascades from it (chapters,
  blueprint, metadata, compliance checks, formatting jobs — every child
  table's foreign key is `on delete cascade`). It does not clean up files
  already sitting in the private `exports`/`uploads` storage buckets, since
  that needs the service-role client and felt like more risk than this
  pass called for — worth doing later if storage costs ever matter.
- **Settings** (`/settings`) — real name/password changes, a real profile
  picture upload (private-per-user-folder, publicly-readable `avatars`
  bucket — `0008_avatars_bucket.sql`), and sign out.
- **Help & Support** (`/help`) — static FAQ.
- **Templates** — honestly labeled "not built yet" rather than faked, since
  no template system exists. **Images** (in-manuscript/interior images) is
  real now — see "Interior/in-manuscript images" below.
- **AI Writing Agent** routes to `/job-progress` for whichever project is
  actually active.
- The **notification bell** is a real dropdown computed from actual
  project status — no fabricated count.
- The **topbar profile** (top-right, your name/avatar) used to sign you
  out the instant you clicked it. It's a real dropdown now — **Change
  Profile Picture** (jumps to `/settings`) and **Sign Out** as two
  separate choices — and shows your real uploaded avatar instead of just
  an initial letter, once you've set one.
- The **sidebar itself scrolls independently** of the main content now —
  it previously had no height/overflow rule, so on a shorter screen its
  lower nav items (Advertising, Publishing, AI Copilot, Templates,
  Compliance Check, Settings, Help) were unreachable; scrolling just moved
  the whole page instead of the menu.

## What's next

All 15 steps of the original build plan are done. What's left is mostly
things that need a real account to verify (confirm the Admin Panel and AI
Copilot behave as expected against your live Supabase project, and that
cover and interior image generation actually produce artwork once billing
is enabled on OpenAI or Google AI Studio/Cloud) or genuine product
decisions rather than more scaffolding — e.g. manual image upload for the
"I'll upload my own" workflow, or building the Templates feature that's
currently honestly labeled "not built yet." See the roadmap in
`InkFrame_Opening_ClaudeCode_Prompt.md` for anything not covered above.
