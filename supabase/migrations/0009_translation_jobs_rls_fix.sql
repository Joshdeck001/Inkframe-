-- Bug fix: translation_jobs' own check constraint allows a row with EITHER
-- source_project_id or source_file set (that's the whole point of
-- supporting uploaded manuscripts, not just existing projects), but the
-- original RLS policy only ever authorized the source_project_id case —
-- "source_project_id is not null" in both USING and WITH CHECK meant every
-- upload-based translation was rejected by RLS, unconditionally, for every
-- user, with no way to ever succeed. Found via a real "Upload manuscript"
-- attempt in production, not caught by earlier syntax-only validation
-- (that never had a real signed-in session to exercise the positive path).
drop policy if exists "translation_jobs: owner full access" on public.translation_jobs;
create policy "translation_jobs: owner full access" on public.translation_jobs
  for all using (
    (source_project_id is not null and owns_project(source_project_id))
    or (source_file is not null and split_part(source_file, '/', 1) = auth.uid()::text)
  )
  with check (
    (source_project_id is not null and owns_project(source_project_id))
    or (source_file is not null and split_part(source_file, '/', 1) = auth.uid()::text)
  );
