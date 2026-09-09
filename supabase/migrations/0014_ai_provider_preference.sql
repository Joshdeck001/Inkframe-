-- Lets a user pin a preferred AI provider instead of always trying
-- Anthropic -> OpenAI -> Gemini in that fixed order (lib/ai-client.ts).
-- 'auto' (the default) keeps today's behavior exactly as-is. Not a broad
-- UPDATE policy on profiles — same reasoning as admin_set_approval in
-- 0007_account_approval.sql: a tightly-scoped RPC that can only ever touch
-- this one column, and only for the caller's own row, so it can't be used
-- to touch role or approval_status.
alter table public.profiles
  add column preferred_ai_provider text not null default 'auto'
  check (preferred_ai_provider in ('auto', 'anthropic', 'openai', 'gemini'));

create or replace function public.set_preferred_ai_provider(new_provider text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if new_provider not in ('auto', 'anthropic', 'openai', 'gemini') then
    raise exception 'invalid preferred_ai_provider: %', new_provider;
  end if;
  update public.profiles set preferred_ai_provider = new_provider where id = auth.uid();
end;
$$;
