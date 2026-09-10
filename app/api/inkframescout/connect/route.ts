import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { generateConnectionCode, hashConnectionCode } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

/**
 * Generates a new InkframeScout connection code from an authenticated
 * Inkframe web session (Settings -> Extensions -> InkframeScout). The
 * raw code is returned exactly once — only its hash is ever stored — so
 * the user copies it immediately and pastes it into the extension's
 * popup (see /api/inkframescout/verify). Each account can hold multiple
 * active connections (e.g. two browsers); nothing here revokes an
 * existing one automatically.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { name } = await request.json().catch(() => ({ name: undefined }));

  const code = generateConnectionCode();
  const { data, error } = await supabase
    .from("extension_connections")
    .insert({ user_id: user.id, token_hash: hashConnectionCode(code), name: typeof name === "string" && name.trim() ? name.trim() : "InkframeScout" })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not generate a connection code." }, { status: 500 });

  return NextResponse.json({ connection_id: data.id, code, created_at: data.created_at });
});
