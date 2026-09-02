-- Trim size (the exported manuscript's physical page size) used to be
-- hardcoded to 6x9in in the Formatting Department with no way for the
-- user to choose it. Now it's a real wizard question, stored per-project.
alter table public.project_scope add column if not exists trim_size text
  check (trim_size in ('5x8', '5.5x8.5', '6x9', '8.5x11'))
  default '6x9';
