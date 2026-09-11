-- Fixes a real, previously-undiscovered bug: research_notes.research_type's
-- CHECK constraint has allowed only
-- 'factual','historical','technical','terminology','platform','title-risk',
-- 'trademark-risk','genre' since 0001_init.sql — but the Research Sessions
-- pipeline (added much later, 0019_research_sessions.sql) and the Suggestion
-- Bar both insert research_notes rows with research_type 'web_search'
-- (lib/research-agent.ts's discovery stage) and 'user_note' (every "add a
-- follow-up note" action, in app/dashboard/page.tsx and app/research/page.tsx).
-- Neither value was ever added to this constraint. Every one of those inserts
-- has been rejected by Postgres and silently discarded (the calling code
-- never checked the insert's error) — meaning: the "Sources" panel in the
-- Research page, which reads research_type='web_search' notes, has always
-- been empty regardless of whether a live web search actually ran, and every
-- follow-up/user note added from the Suggestion Bar or Research page has
-- never actually been saved. See the corresponding code fix in
-- lib/research-agent.ts / app/dashboard/page.tsx / app/research/page.tsx,
-- which now check and surface this kind of error instead of swallowing it.

alter table public.research_notes drop constraint if exists research_notes_research_type_check;
alter table public.research_notes add constraint research_notes_research_type_check
  check (research_type in (
    'factual','historical','technical','terminology','platform','title-risk','trademark-risk','genre',
    'web_search','user_note'
  ));
