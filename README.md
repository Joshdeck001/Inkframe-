# InkFrame

AI-powered book writing and publishing platform. Next.js (App Router) +
Supabase + Anthropic.

## Status

Steps 1-10 of the build plan are done:

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

## What's next

Step 13 (Publishing Engine) reuses `publish.html`, already ported — ready
to pick up directly, same for Step 12 (Translation, `translate.html`) and
Step 15 (Advertising, `advertising.html`). Step 11 (Admin Panel) is the
one that genuinely has no provided mockup, so that's worth a check-in
before building new UI. See the roadmap in
`InkFrame_Opening_ClaudeCode_Prompt.md`.
