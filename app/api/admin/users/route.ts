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
    service.from("profiles").select("id, role").in("id", ids),
    service.from("projects").select("user_id").in("user_id", ids),
  ]);

  const roleById = new Map((profiles ?? []).map((p) => [p.id, p.role as string]));
  const projectCountById = new Map<string, number>();
  for (const row of projects ?? []) {
    projectCountById.set(row.user_id, (projectCountById.get(row.user_id) ?? 0) + 1);
  }

  const users = authUsers.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "(no email)",
      role: roleById.get(u.id) ?? "user",
      created_at: u.created_at,
      project_count: projectCountById.get(u.id) ?? 0,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({ users, truncated: authUsers.users.length >= 200 });
}
