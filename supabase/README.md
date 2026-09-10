# InkFrame — Supabase setup

1. Create a Supabase project (or use an existing one) and grab its URL + anon
   key from **Project Settings → API**. Put them in `.env.local` per
   `.env.local.example` at the repo root.
2. Run the migrations against that project, in order:
   - `supabase/migrations/0001_init.sql` — every table from
     `InkFrame_Project_Record_Schema.md`, with RLS so each user only ever
     sees their own projects (and everything hanging off them).
   - `supabase/migrations/0002_seed.sql` — `platform_profiles` (Amazon KDP /
     GoodNovel / Meganovel rules) and a starter `genre_taxonomy` (Amazon's
     top-level tree, plus the three genres with a written trope add-on:
     Mafia Romance, Small Town Romance, Romantasy).
   - `supabase/migrations/0003_storage.sql` — a private `exports` bucket
     for generated manuscript files (DOCX today). It's private on purpose:
     the app never reads it directly from the browser, only through
     `/api/export-download`, which signs a short-lived URL after checking
     the requester owns the project.
   - `supabase/migrations/0004_publishing_jobs_unique.sql` — one
     `publishing_jobs` row per project+platform, so re-selecting a
     platform in the Publishing Engine refreshes it instead of duplicating.
   - `supabase/migrations/0005_uploads_bucket.sql` — a private `uploads`
     bucket for manuscripts uploaded to the Translation Department, with
     real storage.objects RLS (unlike `exports`, the browser uploads here
     directly as the signed-in user).
   - `supabase/migrations/0006_copilot_session_unique.sql` — one
     `copilot_sessions` row per project, so the AI Copilot's "find or
     create a session" call is a true upsert and `production_paused` has
     one unambiguous value per project for the background cron ticks to
     check.
   - `supabase/migrations/0007_account_approval.sql` — adds
     `profiles.approval_status` (an admin has to approve a new sign-up
     before it can use InkFrame at all) and grandfathers in every account
     that already existed before this migration runs, so running it never
     locks you out of your own project. See "Admin approval for new
     sign-ups" in the root `README.md`.
   - `supabase/migrations/0008_avatars_bucket.sql` — a public `avatars`
     bucket for profile pictures (`/settings`). Public on purpose, unlike
     `exports`/`uploads`: avatars need to render directly as `<img src>`
     without a signed URL. Writes are still owner-scoped, one folder per
     user, same `storage.objects` RLS pattern as `0005_uploads_bucket.sql`.
   - `supabase/migrations/0009_translation_jobs_rls_fix.sql` — a real bug
     fix, found live: `translation_jobs`' own check constraint allows a
     row with either `source_project_id` (an existing book) or
     `source_file` (an uploaded manuscript) set, but the original RLS
     policy only ever authorized the `source_project_id` case — every
     "Upload manuscript" translation was rejected by RLS, for every user,
     unconditionally. Fixed to authorize both, the upload case scoped to
     the uploader's own `{user_id}/...` path prefix, same as the
     `uploads` bucket's own storage policies already do.
   - `supabase/migrations/0010_covers_bucket.sql` — a public `covers`
     bucket for real generated cover artwork (the Cover Department used to
     only ever produce text prompts). Public read, same as `avatars`, for
     the same reason: it needs to render as a plain `<img src>` without
     signed-URL ceremony, and a book cover isn't sensitive content. No
     client insert/update/delete policy — only the server (service-role
     client, from the Cover Department's background tick) ever writes
     here, same as the private `exports` bucket being server-write-only.
   - `supabase/migrations/0011_interior_images.sql` — turns on real
     interior/in-manuscript images (the Image Department). Adds
     `GENERATING_IMAGES` as a new pipeline stage between cover art and
     metadata generation; adds `image_placements.image_attempted`, the
     same bounded-retry bookkeeping the Cover Department uses, so a
     permanently-unavailable image provider doesn't get retried forever;
     adds the foreign key `image_placements.chapter_id` was always
     missing (harmless until something actually populated the column);
     and a public `manuscript-images` bucket, same pattern as `covers`.
   - `supabase/migrations/0012_admin_messages.sql` — real admin-to-user
     messaging for the Admin Panel's Messages tab: `admin_messages`
     (broadcast when `target_user_id` is null, otherwise one specific
     user) and `admin_message_reads` (per-user dismissal, so a read
     message doesn't keep reappearing on the dashboard). Admins get full
     access; everyone else gets read-only access to messages actually
     addressed to them.
   - `supabase/migrations/0013_book_formatting.sql` — adds
     `project_scope.trim_size` (the wizard's new "Trim Size" question —
     `5x8`/`5.5x8.5`/`6x9`/`8.5x11`, defaulting to `6x9`), so the exported
     manuscript's page size is a real user choice instead of hardcoded.
   - `supabase/migrations/0014_ai_provider_preference.sql` — adds
     `profiles.preferred_ai_provider` and a `set_preferred_ai_provider()`
     RPC (security definer, self-scoped via `auth.uid()`) so a user can
     pin their own AI calls (Writing Agent, Quality Loop, Cover, Metadata,
     Research, Advertising, Copilot) to one provider from `/settings`
     without opening a broad `UPDATE` policy on `profiles`.
   - `supabase/migrations/0015_audiobook.sql` — `audiobook_jobs` +
     `audiobook_segments` for Audiobook Studio, and a private
     `audiobooks` storage bucket (server-write-only, played back through a
     signed-URL route — same pattern as `exports`).
   - `supabase/migrations/0016_research_evidence.sql` — real evidence-only
     Research workspace: `competitor_research`, `keyword_research`,
     `category_research`, `research_reports`, plus `source_type`/
     `confidence` columns on `research_notes` so a note is always
     traceable to where it actually came from (never a fabricated finding
     dressed up as data).
   - `supabase/migrations/0017_publishing_declarations.sql` — one
     `publishing_declarations` row per project: the author's own rights
     confirmation and AI-content-disclosure acknowledgment, edited from
     `/publish`. InkFrame has no KDP API to submit either on the author's
     behalf (see "KDP integration" in the root `README.md`), so this is
     purely the record of the author having reviewed and confirmed them
     before publishing — a real gate in the Book Health checklist instead
     of a one-time informational note nobody has to act on.
   - `supabase/migrations/0018_publishing_jobs_background.sql` — upgrades
     `publishing_jobs` (already the one row-per-project-per-platform
     publishing record, unique since `0004`) into the backing store for
     background KDP preparation: `requested_formats`, resumable `stages`,
     `blockers`, `package_ref`, `started_at`/`prepared_at`/`error`, plus
     new status values (`queued`/`running`/`needs_attention`/`failed`/
     `cancelled` alongside the original four). See "Publishing Control
     Center" in the root `README.md` for why this reuses `publishing_jobs`
     instead of a second job table.
   - `supabase/migrations/0019_research_sessions.sql` — adds
     `research_sessions` (a standalone, pre-project research unit — topic,
     mode, platforms, resumable `stages`, optional `project_id`) and
     `research_findings` (the real computed frequency/cluster/gap/
     opportunity-score/concepts output per session). Widens
     `competitor_research`/`keyword_research`/`category_research`/
     `research_notes`/`research_reports` to optionally belong to a session
     instead of only ever a project (`project_id` now nullable, new
     `session_id` column, a check that at least one is set) — the exact
     same evidence/report tables from `0016`, not a second schema. See
     "Research Intelligence" in the root `README.md`.
   - `supabase/migrations/0020_research_platform_intelligence.sql` — adds
     `keyword_research.platform` (competitor_research already had one)
     and three more `research_findings` columns
     (`platform_breakdown`/`keyword_intelligence`/`coverage_matrix`) for
     the real, evidence-gated cross-platform and keyword-intent
     computations `lib/research-agent.ts`'s analysis stage now runs. See
     "Publishing Intelligence Research Department" in the root
     `README.md`.
   - `supabase/migrations/0021_cover_engine.sql` — adds
     `image_generation_log` (real per-attempt usage tracking for every
     OpenAI/Gemini cover-art call — provider, model, quality, real token
     counts from the provider's own response, never a fabricated dollar
     cost) and a private `cover-references` storage bucket for images a
     user uploads to inform or be edited into an AI cover generation. See
     "OpenAI-Powered Cover Engine" in the root `README.md`.
   - `supabase/migrations/0022_inkframescout.sql` — adds
     `extension_connections` (account-scoped browser-extension
     credentials — only a SHA-256 hash is ever stored, never the raw
     code) and `scout_clips` (single deliberate captures from the
     InkframeScout browser extension, awaiting the user's own decision to
     fold each one into a real research session). Widens
     `competitor_research`/`keyword_research`/`category_research`'s
     `source_type` check constraint to add `'browser_clip'` alongside the
     existing `user_provided`/`ai_inference`/`live_web` values. See
     "InkframeScout" in the root `README.md` for why this is a
     single-click clipper, not the automated marketplace-scanning
     extension originally specced.
   - `supabase/migrations/0023_inkframescout_snapshots.sql` — adds
     `scout_snapshots` (an optional label the user attaches to a group of
     clips captured while comparing books in one browsing session) and
     `scout_clips.snapshot_id`/`scout_clips.isbn`. Still one row per one
     deliberate click — a snapshot is a grouping label, not a second
     capture mechanism. `isbn` powers real cross-platform matching
     between clips of the same book on different marketplaces
     (`lib/scout-matching.ts`); see "InkframeScout v2" in the root
     `README.md`.
   - `supabase/migrations/0024_inkframescout_intelligence.sql` — adds
     `scout_clips.bsr`/`category_rank`/`published_date`/
     `extension_version`/`adapter_version` (read the same way `isbn`
     already is — genuinely visible page text, same single click);
     `extension_connections.paused` (pause collection without revoking
     the connection); `competition_sets` + `competition_set_clips` (named
     groups of clips to compare); `watched_books` (a canonical-book
     bookmark, updated only when the user re-clips it — never a
     background poller); `scout_opportunities` (the Opportunity
     Workspace, with a real versioned `score` computed by
     `lib/scout-opportunity.ts`); and widens `research_notes` with
     `opportunity_id`/`competition_set_id` so notes reuse the exact same
     table every other research path already writes to. See
     "InkframeScout Intelligence 2.0" in the root `README.md`.

   Easiest path: open the Supabase dashboard's **SQL Editor**, paste each
   file's contents in order, and run it. If you have the Supabase CLI linked
   to the project instead, `supabase db push` picks up both files from this
   folder automatically.
3. To make yourself an admin (needed for the Admin Panel at `/admin` — there's
   no sidebar link to it, go there directly by URL once you're an admin):
   after you've signed up once through the app, run this in the SQL editor
   (`profiles.role` is intentionally not editable through the app itself, in
   the Admin Panel included — see its Users tab). Set `approval_status` in
   the same statement — otherwise you'd promote yourself to admin while
   still being gated out as a pending account with no other admin around to
   approve you:

   ```sql
   update public.profiles set role = 'admin', approval_status = 'approved'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

No table in this schema is ever written to by anything other than the
InkFrame app itself — `platform_profiles` and `genre_taxonomy` are meant to
be revisited periodically as platform terms change, not treated as
permanent.
