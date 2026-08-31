# InkFrame

AI-powered book writing and publishing platform. Next.js (App Router) +
Supabase + Anthropic.

## Status

Steps 1-5 of the build plan are done:

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

Stopped here per plan, for review before Step 6 (the autonomous Writing
Agent). `job-progress` shows the real project status (currently: queued,
waiting on a Writing Agent that doesn't exist yet) rather than a fabricated
progress bar.

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

## What's next

Step 6 (autonomous Writing Agent), per the roadmap in
`InkFrame_Opening_ClaudeCode_Prompt.md`.
