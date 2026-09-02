import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/** Every message ever sent, newest first, with the recipient's email resolved for display. */
export const GET = withJsonErrors(async () => {
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
  const { data: messages, error } = await service
    .from("admin_messages")
    .select("id, target_user_id, body, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targetIds = [...new Set((messages ?? []).map((m) => m.target_user_id).filter((id): id is string => !!id))];
  const emailById = new Map<string, string>();
  if (targetIds.length > 0) {
    const { data: authUsers } = await service.auth.admin.listUsers({ perPage: 200 });
    for (const u of authUsers?.users ?? []) {
      if (targetIds.includes(u.id)) emailById.set(u.id, u.email ?? "(no email)");
    }
  }

  const result = (messages ?? []).map((m) => ({
    ...m,
    target_email: m.target_user_id ? (emailById.get(m.target_user_id) ?? "(deleted user)") : null,
  }));

  return NextResponse.json({ messages: result });
});

/** Send a new message — broadcast (no target_user_id) or to one specific user. */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { body, target_user_id } = await request.json();
  if (!body || typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "A message body is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("admin_messages")
    .insert({ sender_id: user.id, target_user_id: target_user_id || null, body: body.trim() })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message: data });
});

/** Retract a message the admin sent (e.g. sent to the wrong person, or a typo). */
export const DELETE = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("admin_messages").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
});
