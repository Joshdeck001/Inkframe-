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

   Easiest path: open the Supabase dashboard's **SQL Editor**, paste each
   file's contents in order, and run it. If you have the Supabase CLI linked
   to the project instead, `supabase db push` picks up both files from this
   folder automatically.
3. To make yourself an admin (needed later for the Admin Panel, Step 11):
   after you've signed up once through the app, run this in the SQL editor
   (`profiles.role` is intentionally not editable through the app itself):

   ```sql
   update public.profiles set role = 'admin' where id =
     (select id from auth.users where email = 'you@example.com');
   ```

No table in this schema is ever written to by anything other than the
InkFrame app itself — `platform_profiles` and `genre_taxonomy` are meant to
be revisited periodically as platform terms change, not treated as
permanent.
