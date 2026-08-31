-- InkFrame — initial schema
-- Source of truth: InkFrame_Project_Record_Schema.md (DK 2.0)
-- One canonical project record per book; every department reads/writes the
-- same tables via project_id so nothing re-asks the user for known info.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Profiles (adds an admin role on top of auth.users, for the Admin Panel gate)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

-- role changes are deliberately not user-editable via the API; promote admins
-- from the Supabase dashboard / service role only.

-- ============================================================================
-- Ownership helper functions (used by RLS policies below)
-- ============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'IDEA' check (status in (
    'IDEA','BLUEPRINT','AWAITING_APPROVAL','QUEUED','WRITING','RESEARCHING',
    'REVIEWING','REVISING','FORMATTING','GENERATING_COVER','GENERATING_METADATA',
    'COMPLIANCE_CHECK','READY_FOR_REVIEW','USER_APPROVED','READY_FOR_EXPORT','EXPORTED',
    'AWAITING_CONTRACT_DECISION','CONTRACT_RECEIVED','CONTRACT_NOT_ACCEPTED','REVISION_REQUESTED'
  )),
  book_type text not null check (book_type in (
    'Fiction','Nonfiction','Biography','Memoir','Self-help','Educational',
    'Technical/Professional','Children''s','Serial Fiction','Other'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on public.projects(user_id);
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

create or replace function public.owns_project(pid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.projects p where p.id = pid and p.user_id = auth.uid());
$$;

alter table public.projects enable row level security;
create policy "projects: owner full access" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Step 2 — project_identity
-- ============================================================================

create table public.project_identity (
  project_id uuid primary key references public.projects(id) on delete cascade,
  working_title text,
  subtitle text,
  author_name text,
  pen_name text,
  series_name text,
  series_number int,
  language text,
  target_marketplace text,
  initial_idea text
);
alter table public.project_identity enable row level security;
create policy "project_identity: owner full access" on public.project_identity
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 3 — project_audience
-- ============================================================================

create table public.project_audience (
  project_id uuid primary key references public.projects(id) on delete cascade,
  target_audience text,
  reader_age_group text,
  reader_level text check (reader_level in ('Beginner','Intermediate','Advanced','Professional')),
  primary_reader_problem text,
  desired_reader_outcome text,
  core_promise text,
  purpose text check (purpose in (
    'Teach','Inform','Entertain','Tell a story','Solve a problem','Guide through a process','Inspire','Other'
  ))
);
alter table public.project_audience enable row level security;
create policy "project_audience: owner full access" on public.project_audience
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 4 — project_scope
-- ============================================================================

create table public.project_scope (
  project_id uuid primary key references public.projects(id) on delete cascade,
  target_word_count int,
  estimated_chapter_count int,
  preferred_avg_chapter_words int,
  desired_depth text,
  words_written int not null default 0
);
alter table public.project_scope enable row level security;
create policy "project_scope: owner full access" on public.project_scope
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 5 — project_style
-- ============================================================================

create table public.project_style (
  project_id uuid primary key references public.projects(id) on delete cascade,
  tone text check (tone in (
    'Conversational','Professional','Academic','Warm','Direct','Story-driven',
    'Journalistic','Cinematic','Inspirational','Custom'
  )),
  pov text check (pov in ('First','Second','Third','Mixed')),
  pacing text check (pacing in ('Fast','Balanced','Detailed','Slow/Reflective')),
  depth text check (depth in ('Accessible','Standard','Detailed','Expert')),
  additional_instructions text,
  reference_materials jsonb not null default '[]'::jsonb
);
alter table public.project_style enable row level security;
create policy "project_style: owner full access" on public.project_style
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- platform_profiles (versioned, admin-managed — readable by all authenticated users)
-- ============================================================================

create table public.platform_profiles (
  id uuid primary key default gen_random_uuid(),
  platform_name text not null,
  profile_version text not null,
  last_verified date,
  supported_languages text[] not null default '{}',
  minimum_submission_words int,
  preferred_genres text[] not null default '{}',
  submission_requirements jsonb not null default '{}'::jsonb,
  content_rules jsonb not null default '{}'::jsonb,
  metadata_rules jsonb not null default '{}'::jsonb,
  formatting_rules jsonb not null default '{}'::jsonb,
  image_rules jsonb not null default '{}'::jsonb,
  contract_submission_rules jsonb not null default '{}'::jsonb,
  source_references text[] not null default '{}',
  status text not null default 'active' check (status in ('active','needs_review','deprecated'))
);
alter table public.platform_profiles enable row level security;
create policy "platform_profiles: read all authenticated" on public.platform_profiles
  for select using (auth.role() = 'authenticated');
create policy "platform_profiles: admin write" on public.platform_profiles
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================================
-- Step 6 — project_platform
-- ============================================================================

create table public.project_platform (
  project_id uuid primary key references public.projects(id) on delete cascade,
  platform_target text check (platform_target in (
    'Amazon KDP','Kobo','Apple Books','Google Play Books','GoodNovel','Meganovel','Other','General/None'
  )),
  platform_profile_id uuid references public.platform_profiles(id),
  submission_goal text check (submission_goal in (
    'Initial Submission','Apply for Contract','Continue Contracted Story','Continue Existing Story'
  ))
);
alter table public.project_platform enable row level security;
create policy "project_platform: owner full access" on public.project_platform
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 6 — project_images / image_placements
-- ============================================================================

create table public.project_images (
  project_id uuid primary key references public.projects(id) on delete cascade,
  image_workflow text check (image_workflow in (
    'No Images','Generate Automatically','User Upload','Mixed','Prompts Only'
  )),
  image_types text[] not null default '{}',
  auto_placement_enabled boolean not null default false
);
alter table public.project_images enable row level security;
create policy "project_images: owner full access" on public.project_images
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.image_placements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_id uuid,
  placement_location text,
  prompt text,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','generated','uploaded')),
  file_ref text
);
create index image_placements_project_id_idx on public.image_placements(project_id);
alter table public.image_placements enable row level security;
create policy "image_placements: owner full access" on public.image_placements
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 7 — research_notes / title_risk_checks
-- ============================================================================

create table public.research_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  research_type text check (research_type in (
    'factual','historical','technical','terminology','platform','title-risk','trademark-risk','genre'
  )),
  content text,
  source_url text,
  used_in_chapter_id uuid,
  created_at timestamptz not null default now()
);
create index research_notes_project_id_idx on public.research_notes(project_id);
alter table public.research_notes enable row level security;
create policy "research_notes: owner full access" on public.research_notes
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.title_risk_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title_checked text,
  -- never store/display "100% copyright safe" or "guaranteed legally clear" — risk-flag language only
  status text check (status in (
    'no_issue','potential_conflict','similar_titles_detected','trademark_concern',
    'metadata_issue','human_review_recommended'
  )),
  notes text,
  checked_at timestamptz not null default now()
);
create index title_risk_checks_project_id_idx on public.title_risk_checks(project_id);
alter table public.title_risk_checks enable row level security;
create policy "title_risk_checks: owner full access" on public.title_risk_checks
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- Step 16 — book_blueprint (requires user approval before writing starts)
-- ============================================================================

create table public.book_blueprint (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  version int not null default 1,
  structure jsonb not null default '{}'::jsonb,
  approval_status text not null default 'draft' check (approval_status in ('draft','approved','needs_edit')),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);
create index book_blueprint_project_id_idx on public.book_blueprint(project_id);
alter table public.book_blueprint enable row level security;
create policy "book_blueprint: owner full access" on public.book_blueprint
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- story_bible (fiction only) — the Continuity Engine's source of truth
-- ============================================================================

create table public.story_bible (
  project_id uuid primary key references public.projects(id) on delete cascade,
  characters jsonb not null default '{}'::jsonb,
  locations jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '{}'::jsonb,
  world_rules jsonb not null default '{}'::jsonb,
  important_objects jsonb not null default '{}'::jsonb,
  secrets_reveals jsonb not null default '{}'::jsonb,
  plot_threads jsonb not null default '[]'::jsonb -- each thread tagged open/closed
);
alter table public.story_bible enable row level security;
create policy "story_bible: owner full access" on public.story_bible
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- chapters — one canonical manuscript, no forks between models
-- ============================================================================

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number int not null,
  title text,
  objective text,
  target_words int,
  actual_words int not null default 0,
  content text not null default '',
  status text not null default 'pending' check (status in (
    'pending','writing','written','in_review','revising','approved'
  )),
  quality_score jsonb, -- internal only, never shown as fake scientific certainty
  model_used text,
  revision_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, chapter_number)
);
create index chapters_project_id_idx on public.chapters(project_id);
create trigger chapters_set_updated_at before update on public.chapters
  for each row execute function public.set_updated_at();
alter table public.chapters enable row level security;
create policy "chapters: owner full access" on public.chapters
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- contract_projects (Serial/Platform Mode only)
-- ============================================================================

create table public.contract_projects (
  project_id uuid primary key references public.projects(id) on delete cascade,
  initial_manuscript_status text check (initial_manuscript_status in ('not_started','completed')),
  outline_status text check (outline_status in ('not_started','completed')),
  contract_status text check (contract_status in (
    'awaiting_decision','contract_received','not_accepted','revision_requested','still_waiting'
  )),
  submitted_at timestamptz,
  follow_up_reminder_date date,
  total_target_words int,
  words_already_written int not null default 0,
  words_remaining int generated always as (
    greatest(coalesce(total_target_words, 0) - coalesce(words_already_written, 0), 0)
  ) stored
);
alter table public.contract_projects enable row level security;
create policy "contract_projects: owner full access" on public.contract_projects
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- cover_department / metadata_department / compliance_checks
-- ============================================================================

create table public.cover_department (
  project_id uuid primary key references public.projects(id) on delete cascade,
  input_snapshot jsonb not null default '{}'::jsonb,
  concepts jsonb not null default '[]'::jsonb, -- [{prompt, image_ref, status}]
  final_cover_ref text,
  source text check (source in ('generated','user_uploaded'))
);
alter table public.cover_department enable row level security;
create policy "cover_department: owner full access" on public.cover_department
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.metadata_department (
  project_id uuid primary key references public.projects(id) on delete cascade,
  description_long text,
  description_short text,
  keywords text[] not null default '{}', -- max 7, <=50 chars each (KDP rule, enforced in app)
  categories text[] not null default '{}',
  bisac_codes text[] not null default '{}',
  platform_specific jsonb not null default '{}'::jsonb
);
alter table public.metadata_department enable row level security;
create policy "metadata_department: owner full access" on public.metadata_department
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  platform_profile_id uuid references public.platform_profiles(id),
  check_type text check (check_type in (
    'metadata','title_subtitle','content_restrictions','formatting','images',
    'submission','ai_disclosure','ip_risk','missing_info'
  )),
  -- display language: "Passed InkFrame's current platform checks" — never "guaranteed"
  status text check (status in ('pass','warning','action_required','human_review_required')),
  detail text,
  checked_at timestamptz not null default now()
);
create index compliance_checks_project_id_idx on public.compliance_checks(project_id);
alter table public.compliance_checks enable row level security;
create policy "compliance_checks: owner full access" on public.compliance_checks
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- formatting_jobs / quality_gate / export_records
-- ============================================================================

create table public.formatting_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  trim_size text,
  house_style_id uuid,
  output_formats text[] not null default '{}', -- docx, epub, pdf
  status text not null default 'pending' check (status in ('pending','processing','complete','failed')),
  output_files text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index formatting_jobs_project_id_idx on public.formatting_jobs(project_id);
alter table public.formatting_jobs enable row level security;
create policy "formatting_jobs: owner full access" on public.formatting_jobs
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.quality_gate (
  project_id uuid primary key references public.projects(id) on delete cascade,
  content_check boolean not null default false,
  structure_check boolean not null default false,
  continuity_check boolean not null default false,
  word_count_check boolean not null default false,
  images_check text not null default 'not_required' check (images_check in ('pass','not_required')),
  metadata_check boolean not null default false,
  platform_check boolean not null default false,
  formatting_check boolean not null default false,
  cover_check boolean not null default false,
  overall_readiness_score int check (overall_readiness_score between 0 and 100) -- internal assessment, not a guarantee
);
alter table public.quality_gate enable row level security;
create policy "quality_gate: owner full access" on public.quality_gate
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.export_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  export_type text check (export_type in (
    'full_manuscript','initial_submission','story_outline','individual_chapter','cover','metadata_file'
  )),
  file_ref text,
  exported_at timestamptz not null default now()
);
create index export_records_project_id_idx on public.export_records(project_id);
alter table public.export_records enable row level security;
create policy "export_records: owner full access" on public.export_records
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- site_content (Admin Panel) — powers the CMS editor, admin-write / public-read
-- ============================================================================

create table public.site_content (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text,
  content_type text not null check (content_type in ('text','color','image','link','carousel_slide')),
  page text not null check (page in ('landing','auth','dashboard','wizard','job_progress','global')),
  locked boolean not null default false, -- locked fields are hidden/grayed out in the Admin Panel editor
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create trigger site_content_set_updated_at before update on public.site_content
  for each row execute function public.set_updated_at();
alter table public.site_content enable row level security;
create policy "site_content: read all" on public.site_content
  for select using (true);
create policy "site_content: admin write" on public.site_content
  for insert with check (
    not locked and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "site_content: admin update" on public.site_content
  for update using (
    not locked and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  ) with check (
    not locked and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "site_content: admin delete" on public.site_content
  for delete using (
    not locked and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================================
-- translation_jobs (Translation Department)
-- ============================================================================

create table public.translation_jobs (
  id uuid primary key default gen_random_uuid(),
  source_project_id uuid references public.projects(id) on delete cascade,
  source_file text,
  target_languages text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','translating','reviewing','complete','failed')),
  translated_outputs jsonb not null default '[]'::jsonb, -- [{language, title, subtitle, description, file_ref, word_count}]
  model_used text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint translation_jobs_source check (source_project_id is not null or source_file is not null)
);
create index translation_jobs_source_project_id_idx on public.translation_jobs(source_project_id);
alter table public.translation_jobs enable row level security;
create policy "translation_jobs: owner full access" on public.translation_jobs
  for all using (source_project_id is not null and owns_project(source_project_id))
  with check (source_project_id is not null and owns_project(source_project_id));

-- ============================================================================
-- genre_taxonomy (expandable — NOT a fixed list; readable by all, admin-writable)
-- ============================================================================

create table public.genre_taxonomy (
  id uuid primary key default gen_random_uuid(),
  genre_name text not null,
  parent_genre_id uuid references public.genre_taxonomy(id),
  platform text not null check (platform in ('kdp','goodnovel','meganovel','general')),
  has_trope_addon boolean not null default false,
  addon_content jsonb,
  last_verified date,
  active boolean not null default true
);
create index genre_taxonomy_parent_idx on public.genre_taxonomy(parent_genre_id);
alter table public.genre_taxonomy enable row level security;
create policy "genre_taxonomy: read all authenticated" on public.genre_taxonomy
  for select using (auth.role() = 'authenticated');
create policy "genre_taxonomy: admin write" on public.genre_taxonomy
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================================
-- style_reference_samples
-- ============================================================================

create table public.style_reference_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  sample_file text,
  extracted_pattern jsonb,
  is_saved_house_style boolean not null default false,
  style_name text,
  created_at timestamptz not null default now()
);
create index style_reference_samples_user_id_idx on public.style_reference_samples(user_id);
alter table public.style_reference_samples enable row level security;
create policy "style_reference_samples: owner full access" on public.style_reference_samples
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- Publishing Engine — publishing_jobs / format_editions / cover_specs / publishing_log
-- ============================================================================

create table public.publishing_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_platform text not null check (target_platform in (
    'Amazon KDP','Kobo','Google Play Books','Apple Books','Other'
  )),
  platform_profile_id uuid references public.platform_profiles(id),
  readiness_snapshot jsonb not null default '{}'::jsonb,
  prepared_fields jsonb not null default '{}'::jsonb,
  status text not null default 'preparing' check (status in (
    'preparing','ready_for_review','ready_to_publish','user_marked_published'
  )),
  user_notes text,
  marked_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publishing_jobs_project_id_idx on public.publishing_jobs(project_id);
create trigger publishing_jobs_set_updated_at before update on public.publishing_jobs
  for each row execute function public.set_updated_at();
alter table public.publishing_jobs enable row level security;
create policy "publishing_jobs: owner full access" on public.publishing_jobs
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create table public.format_editions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  format_type text not null check (format_type in ('ebook','paperback','hardcover')),
  manuscript_file text,
  cover_file text,
  page_count int, -- must come from the final formatted manuscript, never estimated
  price numeric(10,2), -- user-approved; InkFrame may suggest but never auto-sets
  status text not null default 'pending' check (status in (
    'pending','in_production','cover_needs_recalculation','ready','error'
  )),
  unique (project_id, format_type)
);
create index format_editions_project_id_idx on public.format_editions(project_id);
alter table public.format_editions enable row level security;
create policy "format_editions: owner full access" on public.format_editions
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create or replace function public.owns_format_edition(fid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.format_editions fe
    where fe.id = fid and public.owns_project(fe.project_id)
  );
$$;

create table public.cover_specs (
  id uuid primary key default gen_random_uuid(),
  format_edition_id uuid not null references public.format_editions(id) on delete cascade,
  trim_width numeric,
  trim_height numeric,
  unit text not null default 'inches',
  page_count int, -- pulled from format_editions.page_count at calculation time
  binding text,
  paper_type text,
  interior_ink_type text,
  bleed_required boolean not null default false,
  calculated_spine_width numeric,
  calculated_full_wrap_width numeric,
  calculated_full_wrap_height numeric,
  safe_area jsonb,
  platform_spec_version text, -- references platform_profiles.profile_version used
  needs_recalculation boolean not null default false,
  calculated_at timestamptz not null default now()
);
create index cover_specs_format_edition_id_idx on public.cover_specs(format_edition_id);
alter table public.cover_specs enable row level security;
create policy "cover_specs: owner full access" on public.cover_specs
  for all using (owns_format_edition(format_edition_id)) with check (owns_format_edition(format_edition_id));

-- Whenever a format edition's page_count changes after a cover was calculated,
-- flag every cover_specs row for that edition as needing recalculation.
create or replace function public.flag_cover_needs_recalculation()
returns trigger
language plpgsql
as $$
begin
  if new.page_count is distinct from old.page_count then
    update public.cover_specs
      set needs_recalculation = true
      where format_edition_id = new.id;
    update public.format_editions
      set status = 'cover_needs_recalculation'
      where id = new.id and status = 'ready';
  end if;
  return new;
end;
$$;

create trigger format_editions_page_count_change
  after update of page_count on public.format_editions
  for each row execute function public.flag_cover_needs_recalculation();

create table public.publishing_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event text not null, -- real events only, never invented/predicted
  occurred_at timestamptz not null default now()
);
create index publishing_log_project_id_idx on public.publishing_log(project_id);
alter table public.publishing_log enable row level security;
create policy "publishing_log: owner full access" on public.publishing_log
  for all using (owns_project(project_id)) with check (owns_project(project_id));

-- ============================================================================
-- AI Copilot — copilot_sessions / copilot_messages
-- ============================================================================

create table public.copilot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  mode text not null default 'text' check (mode in ('voice','text')),
  voice_status text not null default 'idle' check (voice_status in ('listening','muted','thinking','speaking','idle')),
  -- completely independent of voice_status: muting the mic must never pause production,
  -- and pausing production must never affect voice_status.
  production_paused boolean not null default false,
  created_at timestamptz not null default now()
);
create index copilot_sessions_project_id_idx on public.copilot_sessions(project_id);
alter table public.copilot_sessions enable row level security;
create policy "copilot_sessions: owner full access" on public.copilot_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.owns_copilot_session(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.copilot_sessions s where s.id = sid and s.user_id = auth.uid());
$$;

create table public.copilot_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.copilot_sessions(id) on delete cascade,
  role text not null check (role in ('user','inkframe')),
  content text not null,
  triggered_action text,
  created_at timestamptz not null default now()
);
create index copilot_messages_session_id_idx on public.copilot_messages(session_id);
alter table public.copilot_messages enable row level security;
create policy "copilot_messages: owner full access" on public.copilot_messages
  for all using (owns_copilot_session(session_id)) with check (owns_copilot_session(session_id));

-- ============================================================================
-- Advertising Department
-- ============================================================================

create table public.advertising_projects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'no_data' check (status in (
    'no_data','strategy_drafted','testing','performing_well','needs_attention'
  )),
  created_at timestamptz not null default now(),
  unique (project_id)
);
create index advertising_projects_project_id_idx on public.advertising_projects(project_id);
alter table public.advertising_projects enable row level security;
create policy "advertising_projects: owner full access" on public.advertising_projects
  for all using (owns_project(project_id)) with check (owns_project(project_id));

create or replace function public.owns_advertising_project(aid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.advertising_projects ap
    where ap.id = aid and public.owns_project(ap.project_id)
  );
$$;

create table public.advertising_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertising_project_id uuid not null references public.advertising_projects(id) on delete cascade,
  campaign_name text, -- InkFrame suggests BOOKNAME_KEYWORD_01, user-editable
  campaign_type text check (campaign_type in (
    'automatic','manual_keyword','product_targeting','category_targeting','discovery_test','defensive'
  )),
  objective text,
  daily_budget numeric(10,2), -- user enters
  bid_strategy_recommendation text,
  status text not null default 'draft' check (status in (
    'draft','ready_for_handoff','user_marked_live','paused','ended'
  ))
);
create index advertising_campaigns_ad_project_idx on public.advertising_campaigns(advertising_project_id);
alter table public.advertising_campaigns enable row level security;
create policy "advertising_campaigns: owner full access" on public.advertising_campaigns
  for all using (owns_advertising_project(advertising_project_id))
  with check (owns_advertising_project(advertising_project_id));

create or replace function public.owns_ad_campaign(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.advertising_campaigns c
    where c.id = cid and public.owns_advertising_project(c.advertising_project_id)
  );
$$;

create table public.advertising_keywords (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.advertising_campaigns(id) on delete cascade,
  keyword text not null,
  "group" text check ("group" in (
    'primary','long_tail','buyer_intent','competitor_product_targeting','experimental','negative'
  )),
  rationale text
);
create index advertising_keywords_campaign_idx on public.advertising_keywords(campaign_id);
alter table public.advertising_keywords enable row level security;
create policy "advertising_keywords: owner full access" on public.advertising_keywords
  for all using (campaign_id is not null and owns_ad_campaign(campaign_id))
  with check (campaign_id is not null and owns_ad_campaign(campaign_id));

-- computed on read, not stored: CTR, CPC, ACOS, ROAS, conversion rate.
-- ACOS = spend/sales*100, ROAS = sales/spend — both must handle zero/null safely
-- and the app must display "Cannot be calculated from available data" rather than NaN/Infinity.
create table public.advertising_metrics (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.advertising_campaigns(id) on delete cascade,
  date_range_start date not null,
  date_range_end date not null,
  impressions numeric, -- null = "Not available", never zero-filled or estimated
  clicks numeric,
  spend numeric,
  orders numeric,
  sales numeric,
  source text not null check (source in ('csv_import','manual_entry','authorized_api')),
  imported_at timestamptz not null default now()
);
create index advertising_metrics_campaign_idx on public.advertising_metrics(campaign_id);
alter table public.advertising_metrics enable row level security;
create policy "advertising_metrics: owner full access" on public.advertising_metrics
  for all using (owns_ad_campaign(campaign_id)) with check (owns_ad_campaign(campaign_id));

create table public.advertising_recommendations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.advertising_campaigns(id) on delete cascade,
  issue text not null,
  recommendation text not null,
  -- "applied_to_plan" only ever edits InkFrame's own draft plan, never a live ad account
  user_action text not null default 'pending' check (user_action in ('pending','applied_to_plan','ignored'))
);
create index advertising_recommendations_campaign_idx on public.advertising_recommendations(campaign_id);
alter table public.advertising_recommendations enable row level security;
create policy "advertising_recommendations: owner full access" on public.advertising_recommendations
  for all using (owns_ad_campaign(campaign_id)) with check (owns_ad_campaign(campaign_id));

create table public.advertising_experiments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.advertising_campaigns(id) on delete cascade,
  test_name text not null,
  variable text,
  start_date date,
  end_date date,
  result text,
  conclusion text -- AI-assisted interpretation, explicitly flagged as not statistically certain on small datasets
);
create index advertising_experiments_campaign_idx on public.advertising_experiments(campaign_id);
alter table public.advertising_experiments enable row level security;
create policy "advertising_experiments: owner full access" on public.advertising_experiments
  for all using (owns_ad_campaign(campaign_id)) with check (owns_ad_campaign(campaign_id));
