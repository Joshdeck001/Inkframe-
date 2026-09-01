import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Read-only user list for the Admin Panel. Role changes are deliberately
 * not exposed here or anywhere else in the app (see the schema's comment
 * on `profiles.role`) — this only ever reports what's real, never lets an
 * admin promote/demote another user through the UI.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const service = createServiceClient();

  const { data: authUsers, error: authError } = await service.auth.admin.listUsers({ perPage: 200 });
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 });

  const ids = authUsers.users.map((u) => u.id);
  const [{ data: profiles }, { data: projects }] = await Promise.all([
    service.from("profiles").select("id, role, approval_status").in("id", ids),
    service.from("projects").select("user_id").in("user_id", ids),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const projectCountById = new Map<string, number>();
  for (const row of projects ?? []) {
    projectCountById.set(row.user_id, (projectCountById.get(row.user_id) ?? 0) + 1);
  }

  const APPROVAL_RANK: Record<string, number> = { pending: 0, rejected: 1, approved: 2 };

  const users = authUsers.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      role: profileById.get(u.id)?.role ?? "user",
      approval_status: profileById.get(u.id)?.approval_status ?? "pending",
      created_at: u.created_at,
      project_count: projectCountById.get(u.id) ?? 0,
    }))
    .sort((a, b) => {
      const rankDiff = (APPROVAL_RANK[a.approval_status] ?? 0) - (APPROVAL_RANK[b.approval_status] ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return NextResponse.json({ users, truncated: authUsers.users.length >= 200 });
}

/**
 * Approve/reject a pending account. Delegates entirely to the
 * admin_set_approval() DB function (called with the requesting admin's own
 * session, not the service role, so its internal auth.uid() admin check
 * actually applies) — this route has no separate authorization logic of
 * its own to keep in sync with it.
 */
export async function POST(request: Request) {
  const { user_id, approval_status } = await request.json();
  if (!user_id || !["approved", "rejected", "pending"].includes(approval_status)) {
    return NextResponse.json({ error: "user_id and a valid approval_status are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { error } = await supabase.rpc("admin_set_approval", {
    target_user_id: user_id,
    new_status: approval_status,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });

  return NextResponse.json({ ok: true });
}
