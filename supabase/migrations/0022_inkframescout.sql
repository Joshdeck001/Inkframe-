-- InkframeScout: account-scoped browser-extension connections, and the
-- clips a user deliberately captures one at a time (never automated bulk
-- scanning — see the extension's own README for why). A clip is raw
-- captured data awaiting the user's own decision to fold it into a real
-- research session; it is NOT itself evidence until assigned, and it
-- never bypasses the existing evidence/report tables from migrations
-- 0016/0019 — assigning a clip inserts into the SAME
-- competitor_research/keyword_research rows every other research path
-- already uses, tagged with a new 'browser_clip' source_type so its
-- provenance (a real page the user was looking at, captured with one
-- explicit click) stays distinguishable from both AI inference and
-- hand-typed entry.

create table public.extension_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Only a SHA-256 hash is ever stored — the raw connection code is shown
  -- to the user exactly once at generation time and never persisted.
  token_hash text not null unique,
  name text not null default 'InkframeScout',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked'))
);
create index extension_connections_user_id_idx on public.extension_connections(user_id);
alter table public.extension_connections enable row level security;
create policy "extension_connections: owner full access" on public.extension_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.scout_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.extension_connections(id) on delete set null,
  marketplace text not null check (marketplace in ('amazon', 'google_play_books', 'kobo')),
  source_url text not null,
  title text,
  author text,
  external_id text, -- ASIN/ISBN/product id, whatever was visible in the URL/page
  price numeric(10, 2),
  currency text,
  category text,
  rating numeric(2, 1),
  review_count int,
  -- Everything else the single-click extraction found, kept verbatim for
  -- forward compatibility without needing a migration per new field.
  raw_fields jsonb not null default '{}'::jsonb,
  clipped_at timestamptz not null default now(),
  assigned_session_id uuid references public.research_sessions(id) on delete set null,
  assigned_project_id uuid references public.projects(id) on delete set null,
  status text not null default 'unassigned' check (status in ('unassigned', 'assigned', 'discarded'))
);
create index scout_clips_user_id_idx on public.scout_clips(user_id);
alter table public.scout_clips enable row level security;
create policy "scout_clips: owner full access" on public.scout_clips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.competitor_research drop constraint if exists competitor_research_source_type_check;
alter table public.competitor_research add constraint competitor_research_source_type_check
  check (source_type in ('user_provided', 'ai_inference', 'live_web', 'browser_clip'));

alter table public.keyword_research drop constraint if exists keyword_research_source_type_check;
alter table public.keyword_research add constraint keyword_research_source_type_check
  check (source_type in ('user_provided', 'ai_inference', 'live_web', 'browser_clip'));

alter table public.category_research drop constraint if exists category_research_source_type_check;
alter table public.category_research add constraint category_research_source_type_check
  check (source_type in ('user_provided', 'ai_inference', 'live_web', 'browser_clip'));
