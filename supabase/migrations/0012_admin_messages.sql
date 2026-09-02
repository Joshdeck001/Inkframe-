-- Real admin -> user messaging. An admin writes a message from the Admin
-- Panel (broadcast to everyone, or targeted at one user), and it shows up
-- for the recipient(s) on the dashboard's notification bell — same real,
-- computed-from-actual-data pattern as the existing project-status
-- notifications, not a fabricated inbox.

create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade, -- null = everyone
  body text not null,
  created_at timestamptz not null default now()
);
create index admin_messages_target_user_id_idx on public.admin_messages(target_user_id);
alter table public.admin_messages enable row level security;

-- Admins: full read/write/delete on every message, same inline
-- role-check pattern used by every other admin-write policy in this schema
-- (no shared is_admin() helper exists, so this matches that precedent).
create policy "admin_messages: admin full access" on public.admin_messages
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Everyone else: read-only, and only messages actually addressed to them
-- (their own targeted messages, or a broadcast).
create policy "admin_messages: recipient read" on public.admin_messages
  for select using (target_user_id = auth.uid() or target_user_id is null);

-- Per-user dismissal state, so a message a user has already seen doesn't
-- keep reappearing on every dashboard load, on any device.
create table public.admin_message_reads (
  message_id uuid not null references public.admin_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.admin_message_reads enable row level security;
create policy "admin_message_reads: owner full access" on public.admin_message_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
