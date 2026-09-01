-- One copilot session per project: makes "find-or-create" a true upsert,
-- and lets department cron ticks answer "is this project paused?" with a
-- single-row lookup instead of scanning every session ever opened for it.
alter table public.copilot_sessions
  add constraint copilot_sessions_project_id_unique unique (project_id);
