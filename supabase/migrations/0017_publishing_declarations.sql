-- Publishing declarations: two real author self-attestations Amazon KDP
-- (and every other platform) actually asks for during upload — rights to
-- publish, and AI-generated-content disclosure. InkFrame cannot submit
-- these on the author's behalf (no KDP API exists to do that — see
-- README's "KDP integration" section), so this is the InkFrame-side
-- record of the author having reviewed and confirmed them, surfaced as a
-- real gate in the Book Health checklist rather than left as a one-time
-- informational compliance_checks row nobody has to act on.
--
-- One row per project, edited from /publish. Deliberately separate from
-- compliance_checks (that table is an append-only automated-run audit
-- log; this is an editable author attestation with exactly one current
-- value per project).

create table public.publishing_declarations (
  project_id uuid primary key references public.projects(id) on delete cascade,
  rights_basis text check (rights_basis in (
    'original', 'public_domain', 'licensed', 'other'
  )),
  rights_note text,
  rights_confirmed boolean not null default false,
  ai_disclosure_acknowledged boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger publishing_declarations_set_updated_at before update on public.publishing_declarations
  for each row execute function public.set_updated_at();
alter table public.publishing_declarations enable row level security;
create policy "publishing_declarations: owner full access" on public.publishing_declarations
  for all using (owns_project(project_id)) with check (owns_project(project_id));
