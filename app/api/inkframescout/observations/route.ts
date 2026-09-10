import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { withJsonErrors } from "@/lib/api-guard";
import { resolveConnection, extractBearerToken } from "@/lib/scout-connection";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARKETPLACES = ["amazon", "google_play_books", "kobo"];

/**
 * Records ONE clip — the deliberate, single-click capture of the page
 * the user is currently looking at (see /extension/README.md for why
 * this is a one-shot user-triggered action, never a background scanner).
 * Resolves the owning user from the bearer token server-side; the
 * extension never sends a user_id the server would have to trust. A
 * clip lands in scout_clips as raw captured data — it only becomes real
 * research evidence once the user reviews and assigns it from
 * /research's "My Clips" panel, same evidence tables every other
 * research path already writes to.
 */
export const POST = withJsonErrors(async (request: Request) => {
  const token = extractBearerToken(request);
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const body = await request.json();
  const { marketplace, source_url, title, author, external_id, price, currency, category, rating, review_count, raw_fields } = body;

  if (!MARKETPLACES.includes(marketplace)) return NextResponse.json({ error: `marketplace must be one of: ${MARKETPLACES.join(", ")}` }, { status: 400 });
  if (typeof source_url !== "string" || !source_url) return NextResponse.json({ error: "source_url is required" }, { status: 400 });

  const service = createServiceClient();
  const resolved = await resolveConnection(service, token);
  if (!resolved) return NextResponse.json({ error: "Connection is invalid or revoked." }, { status: 401 });

  const { data, error } = await service
    .from("scout_clips")
    .insert({
      user_id: resolved.userId,
      connection_id: resolved.connectionId,
      marketplace,
      source_url,
      title: typeof title === "string" ? title.slice(0, 500) : null,
      author: typeof author === "string" ? author.slice(0, 300) : null,
      external_id: typeof external_id === "string" ? external_id.slice(0, 100) : null,
      price: typeof price === "number" ? price : null,
      currency: typeof currency === "string" ? currency.slice(0, 10) : null,
      category: typeof category === "string" ? category.slice(0, 300) : null,
      rating: typeof rating === "number" ? rating : null,
      review_count: typeof review_count === "number" ? review_count : null,
      raw_fields: raw_fields && typeof raw_fields === "object" ? raw_fields : {},
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message || "Could not save the clip." }, { status: 500 });

  return NextResponse.json({ clip_id: data.id });
});
