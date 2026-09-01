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
