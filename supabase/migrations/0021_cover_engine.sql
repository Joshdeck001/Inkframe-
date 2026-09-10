-- Real usage tracking for every image-generation/edit call the Cover
-- Designer makes — token counts only ever come from what the provider's
-- API response actually returned (see lib/openai-image-provider.ts);
-- this deliberately has no dollar-cost column. This sandbox can't reach
-- OpenAI's pricing page to verify current per-image pricing, and
-- inventing a $ figure here would be exactly the fabricated-data problem
-- this whole app's research/publishing features already refuse to do
-- elsewhere — real token counts are recorded instead, so a user (or a
-- later, verified pricing table) can compute real cost from real usage.
create table public.image_generation_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'gemini')),
  model text not null,
  operation text not null check (operation in ('generate', 'edit')),
  quality text,
  requested_size text,
  input_image_count int not null default 0,
  status text not null check (status in ('success', 'failed')),
  error text,
  image_tokens int,
  text_tokens int,
  created_at timestamptz not null default now()
);
create index image_generation_log_project_id_idx on public.image_generation_log(project_id);
create index image_generation_log_user_id_idx on public.image_generation_log(user_id);
alter table public.image_generation_log enable row level security;
create policy "image_generation_log: owner full access" on public.image_generation_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reference images a user uploads for the Cover Designer (moodboard,
-- character reference, an existing cover to improve) — distinct from
-- the `covers` bucket's final-cover-art use, and distinct from the
-- generated concept art (see cover_department.concepts jsonb, whose
-- shape gains reference_image_ref/version/parent_version/source fields
-- this round without needing a migration, since it was already jsonb).
insert into storage.buckets (id, name, public)
values ('cover-references', 'cover-references', false)
on conflict (id) do nothing;
