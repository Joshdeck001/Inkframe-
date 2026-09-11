import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { analyzeBookIntelligence, type BookClipEvidence } from "@/lib/book-intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turns one captured InkframeScout clip into a real Book Intelligence
 * Workspace: a snapshot of the book, what the evidence suggests is
 * working, what may be missing, and typed opportunity ideas — all
 * grounded strictly in that clip's own real fields (see
 * lib/book-intelligence.ts). One scout_opportunities row per clip
 * (upserted on source_clip_id) so re-running refreshes the analysis in
 * place rather than creating duplicates every time the user revisits it.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { clip_id } = await request.json();
  if (typeof clip_id !== "string" || !clip_id) return NextResponse.json({ error: "clip_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  // RLS already scopes this to the caller's own clip.
  const { data: clip, error: clipError } = await supabase
    .from("scout_clips")
    .select("title, author, publisher, category, price, currency, rating, review_count, bsr, category_rank, published_date, isbn, marketplace")
    .eq("id", clip_id)
    .not("title", "is", null)
    .maybeSingle();
  if (clipError) return NextResponse.json({ error: clipError.message }, { status: 500 });
  if (!clip) return NextResponse.json({ error: "Clip not found, or it has no title yet." }, { status: 404 });

  let analysis;
  try {
    analysis = await analyzeBookIntelligence(supabase, user.id, clip as BookClipEvidence);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not analyze this book." }, { status: 502 });
  }

  const { data: existing } = await supabase.from("scout_opportunities").select("id").eq("source_clip_id", clip_id).maybeSingle();

  const row = {
    user_id: user.id,
    title: clip.title,
    source_clip_id: clip_id,
    book_snapshot: analysis.book_snapshot,
    whats_working: analysis.whats_working,
    whats_missing: analysis.whats_missing,
    opportunity_ideas: analysis.opportunity_ideas,
  };

  const { data: saved, error: saveError } = existing
    ? await supabase.from("scout_opportunities").update(row).eq("id", existing.id).select().single()
    : await supabase.from("scout_opportunities").insert(row).select().single();
  if (saveError || !saved) return NextResponse.json({ error: saveError?.message || "Could not save this analysis." }, { status: 500 });

  return NextResponse.json({ opportunity: saved });
});
