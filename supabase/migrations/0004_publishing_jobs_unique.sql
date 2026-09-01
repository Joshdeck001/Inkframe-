-- One prepared package per platform per project — re-selecting the same
-- platform in the Publishing Engine refreshes its prepared_fields instead
-- of creating a duplicate row.

alter table public.publishing_jobs
  add constraint publishing_jobs_project_platform_unique unique (project_id, target_platform);
