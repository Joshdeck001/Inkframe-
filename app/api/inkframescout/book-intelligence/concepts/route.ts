import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { generateBookConcepts, type BookClipEvidence, type OpportunityIdea } from "@/lib/book-intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Generate Original Concepts" — the step after a Book Intelligence
 * analysis has real opportunity_ideas to ground concepts in (never called
 * before analyze; requires opportunity_ideas to already exist). Appends
 * newly generated concepts (each starting status: "proposed") to any
 * already on the opportunity rather than replacing them, so re-running
 * this for more ideas never discards a concept the user already accepted
 * or rejected.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { opportunity_id } = await request.json();
  if (typeof opportunity_id !== "string" || !opportunity_id) return NextResponse.json({ error: "opportunity_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const { data: opportunity, error: oppError } = await supabase
    .from("scout_opportunities")
    .select("id, source_clip_id, opportunity_ideas, concepts")
    .eq("id", opportunity_id)
    .maybeSingle();
  if (oppError) return NextResponse.json({ error: oppError.message }, { status: 500 });
  if (!opportunity) return NextResponse.json({ error: "Opportunity not found." }, { status: 404 });
  if (!opportunity.source_clip_id) return NextResponse.json({ error: "This opportunity isn't linked to a single captured book." }, { status: 400 });

  const opportunityIdeas = (opportunity.opportunity_ideas ?? []) as OpportunityIdea[];
  if (opportunityIdeas.length === 0) return NextResponse.json({ error: "Run Analyze Book first — there are no opportunity ideas to ground concepts in yet." }, { status: 400 });

  const { data: clip, error: clipError } = await supabase
    .from("scout_clips")
    .select("title, author, publisher, category, price, currency, rating, review_count, bsr, category_rank, published_date, isbn, marketplace")
    .eq("id", opportunity.source_clip_id)
    .maybeSingle();
  if (clipError) return NextResponse.json({ error: clipError.message }, { status: 500 });
  if (!clip) return NextResponse.json({ error: "The captured book behind this opportunity could not be found." }, { status: 404 });

  let result;
  try {
    result = await generateBookConcepts(supabase, user.id, clip as BookClipEvidence, opportunityIdeas);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not generate concepts." }, { status: 502 });
  }

  const newConcepts = result.concepts.map((c) => ({ ...c, status: "proposed" as const }));
  const concepts = [...((opportunity.concepts as unknown[]) ?? []), ...newConcepts];

  const { data: saved, error: saveError } = await supabase.from("scout_opportunities").update({ concepts }).eq("id", opportunity_id).select().single();
  if (saveError || !saved) return NextResponse.json({ error: saveError?.message || "Could not save these concepts." }, { status: 500 });

  return NextResponse.json({ opportunity: saved });
});
