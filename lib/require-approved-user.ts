import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

type ApprovedResult = { user: User; error: null; status: 200 } | { user: null; error: string; status: 401 | 403 };

/**
 * Same approval gate as the page-level middleware redirect, enforced at the
 * API layer too — a pending account can't reach a protected page, but a
 * valid session cookie would otherwise still let it call these routes
 * directly. Fails closed: a missing/unreadable profile is treated as not
 * approved rather than let through.
 */
export async function requireApprovedUser(supabase: SupabaseClient): Promise<ApprovedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: "Not signed in", status: 401 };

  const { data: profile } = await supabase.from("profiles").select("approval_status").eq("id", user.id).single();
  if (profile?.approval_status !== "approved") {
    return { user: null, error: "Your account is awaiting admin approval.", status: 403 };
  }
  return { user, error: null, status: 200 };
}
