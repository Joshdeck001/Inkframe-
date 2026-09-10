import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { RESEARCH_MODES, RESEARCH_PLATFORMS } from "@/lib/research-agent";

export const dynamic = "force-dynamic";

const MODES: readonly string[] = RESEARCH_MODES;
const PLATFORMS: readonly string[] = RESEARCH_PLATFORMS;

/**
 * The explicit human-approval gate for background Deep Research (same
 * convention as /api/audiobook/start and /api/kdp-prepare/start) — a
 * session never starts investigating on its own. Topic can be empty on
 * purpose: that's "Discover Opportunities" mode (spec section 16), where
 * lib/research-agent.ts's discovery stage searches for general
 * promising-niche signals instead of one specific topic.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { topic, mode, platforms } = await request.json();
  if (!MODES.includes(mode)) return NextResponse.json({ error: `mode must be one of: ${MODES.join(", ")}` }, { status: 400 });
  const platformList: string[] = Array.isArray(platforms) && platforms.length > 0 ? platforms : ["web"];
  if (!platformList.every((p) => PLATFORMS.includes(p))) {
    return NextResponse.json({ error: `platforms must be a subset of: ${PLATFORMS.join(", ")}` }, { status: 400 });
  }

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: session, error } = await supabase
    .from("research_sessions")
    .insert({
      user_id: user.id,
      topic: (topic ?? "").trim(),
      mode,
      platforms: platformList,
      status: "queued",
      stages: [],
    })
    .select("id")
    .single();
  if (error || !session) return NextResponse.json({ error: error?.message || "Could not start research." }, { status: 500 });

  return NextResponse.json({ session_id: session.id });
});
