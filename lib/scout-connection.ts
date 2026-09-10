import { randomBytes, createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * InkframeScout connection tokens — high-entropy, hashed server-side,
 * never stored raw (spec section 9/69). The raw code is shown to the
 * user exactly once at generation time; every later lookup only ever
 * compares hashes. Every extension-authenticated route resolves the
 * user server-side from this table — the extension never sends a
 * user_id/workspace_id the server would have to trust.
 */

export function generateConnectionCode(): string {
  // 32 bytes of real entropy, base64url so it's easy to paste into the extension.
  return randomBytes(32).toString("base64url");
}

export function hashConnectionCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export type ResolvedConnection = { connectionId: string; userId: string };

/** Resolves a bearer token to its owning user, or null if invalid/revoked. Never trusts a client-supplied user id. */
export async function resolveConnection(supabase: SupabaseClient, rawToken: string): Promise<ResolvedConnection | null> {
  const tokenHash = hashConnectionCode(rawToken);
  const { data } = await supabase
    .from("extension_connections")
    .select("id, user_id, status")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  await supabase.from("extension_connections").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { connectionId: data.id, userId: data.user_id };
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}
