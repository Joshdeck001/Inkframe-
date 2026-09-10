import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { withJsonErrors } from "@/lib/api-guard";
import { generateDifferentiation } from "@/lib/scout-differentiation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * "What would you build instead?" (spec section 10) — called from the
 * Research page (session auth, not the extension's bearer token). Needs
 * a real server-side AI call, so unlike the plain-CRUD Scout panels
 * (Competition Sets/Watchlist, which write directly through Supabase RLS
 * like the rest of this page already does) this genuinely needs a route.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const { clip_ids, opportunity_id } = await request.json();
  if (!Array.isArray(clip_ids) || clip_ids.length === 0) return NextResponse.json({ error: "clip_ids is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  // RLS already scopes this to the caller's own clips — no separate ownership check needed.
  const { data: clips, error } = await supabase
    .from("scout_clips")
    .select("title, author, publisher, category, price, rating, review_count")
    .in("id", clip_ids)
    .not("title", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!clips || clips.length === 0) return NextResponse.json({ error: "No matching clips with a title were found." }, { status: 404 });

  let result;
  try {
    result = await generateDifferentiation(
      supabase,
      user.id,
      clips as { title: string; author: string | null; publisher: string | null; category: string | null; price: number | null; rating: number | null; review_count: number | null }[]
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not generate differentiation analysis." }, { status: 502 });
  }

  if (typeof opportunity_id === "string" && opportunity_id) {
    await supabase
      .from("scout_opportunities")
      .update({
        potential_audience: result.what_the_book_does.audience,
        potential_positioning: [result.what_the_book_does.positioning, ...result.differentiation_directions].join("\n\n"),
        potential_differentiation: result.differentiation_directions.join("\n"),
        risks: result.possible_gaps.join("\n"),
      })
      .eq("id", opportunity_id);
  }

  return NextResponse.json({ result });
});
