-- Admin approval gate: a new sign-up can't reach any protected page or
-- action until an admin approves the account. Existing users (anyone
-- already using the app before this migration runs) are grandfathered in
-- as approved so nobody who was already trusted gets locked out —
-- including whichever account you're about to promote to admin below.
alter table public.profiles
  add column approval_status text not null default 'pending'
  check (approval_status in ('pending', 'approved', 'rejected'));

update public.profiles set approval_status = 'approved';

-- A tightly-scoped RPC, not a broad UPDATE policy on profiles: it only ever
-- touches approval_status, and only when the caller is already an admin.
-- role stays impossible to change through the app either way (see the
-- comment on profiles.role above) — this can't be used to self-promote.
create or replace function public.admin_set_approval(target_user_id uuid, new_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if new_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid approval_status: %', new_status;
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  update public.profiles set approval_status = new_status where id = target_user_id;
end;
$$;
