import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";

/**
 * The extension calls this once, right after the user pastes the
 * connection code into its popup, to confirm pairing succeeded. Uses the
 * service-role client since the extension has no Inkframe web session —
 * the code itself is the only credential, resolved server-side, never a
 * client-supplied user id.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { code } = await request.json();
  if (typeof code !== "string" || !code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, code);
  if (!resolved) return NextResponse.json({ error: "That connection code is invalid, expired, or has been revoked." }, { status: 401 });

  const { data: userData } = await service.auth.admin.getUserById(resolved.userId);

  return NextResponse.json({ connected: true, account_email: userData?.user?.email ?? null });
});
