import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { withCors, corsPreflight } from "@/lib/scout-cors";
import { resolveConnection } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;

/**
 * The extension calls this once, right after the user pastes the
 * connection code into its popup, to confirm pairing succeeded. Uses the
 * service-role client since the extension has no Inkframe web session —
 * the code itself is the only credential, resolved server-side, never a
 * client-supplied user id.
 */
export const POST = withCors(withJsonErrors(async (request: Request) => {
  const { code, device_type, browser_name, browser_version } = await request.json();
  if (typeof code !== "string" || !code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, code);
  if (!resolved) return NextResponse.json({ error: "That connection code is invalid, expired, or has been revoked." }, { status: 401 });

  // Real device metadata, reported honestly by the connecting browser itself (see
  // extension/lib/browser-capabilities.js's detectDeviceInfo()) — never guessed
  // server-side. Lets one InkFrame account show every connected device (spec:
  // "Device Registration") without a second table — a connection already IS a device.
  await service
    .from("extension_connections")
    .update({
      device_type: device_type === "mobile" || device_type === "desktop" ? device_type : null,
      browser_name: typeof browser_name === "string" ? browser_name.slice(0, 50) : null,
      browser_version: typeof browser_version === "string" ? browser_version.slice(0, 30) : null,
    })
    .eq("id", resolved.connectionId);

  const { data: userData } = await service.auth.admin.getUserById(resolved.userId);

  return NextResponse.json({ connected: true, account_email: userData?.user?.email ?? null });
}));
