-- InkframeScout: Market Snapshots and cross-platform book matching, built
-- entirely on top of the existing single-click clip flow from 0022 — no
-- new extraction mechanism, no automated/background scanning added.
--
-- A "snapshot" just groups clips the user deliberately clicked, one at a
-- time, while comparing a set of books (their own browsing session). It's
-- a label on scout_clips, nothing more: still one row per one click.
--
-- `isbn` is a second identifier extract.js now also reads off the already-
-- rendered page (same click, same read-only rule as every other field) so
-- clips of the same physical book captured on different marketplaces can
-- be matched to each other by a real shared identifier instead of guessed
-- from title text alone.

create table public.scout_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Untitled snapshot',
  created_at timestamptz not null default now()
);
create index scout_snapshots_user_id_idx on public.scout_snapshots(user_id);
alter table public.scout_snapshots enable row level security;
create policy "scout_snapshots: owner full access" on public.scout_snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.scout_clips add column snapshot_id uuid references public.scout_snapshots(id) on delete set null;
alter table public.scout_clips add column isbn text;
create index scout_clips_snapshot_id_idx on public.scout_clips(snapshot_id);
create index scout_clips_user_isbn_idx on public.scout_clips(user_id, isbn) where isbn is not null;
