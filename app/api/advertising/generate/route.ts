import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireApprovedUser } from "@/lib/require-approved-user";
import { generateStructured, type ToolSpec } from "@/lib/ai-client";
import { withJsonErrors } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro's standard ceiling

const STRATEGY_TOOL: ToolSpec = {
  name: "draft_ad_strategy",
  description: "Draft a starting Amazon Ads keyword list and campaign structure for a book — recommendations only, never live account changes.",
  input_schema: {
    type: "object" as const,
    properties: {
      keywords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string" },
            group: {
              type: "string",
              enum: ["primary", "long_tail", "buyer_intent", "competitor_product_targeting", "experimental", "negative"],
            },
            rationale: { type: "string" },
          },
          required: ["keyword", "group", "rationale"],
        },
        minItems: 10,
        maxItems: 20,
      },
      campaign: {
        type: "object",
        properties: {
          campaign_name: { type: "string", description: "Pattern: BOOKNAME_KEYWORD_01" },
          campaign_type: {
            type: "string",
            enum: ["automatic", "manual_keyword", "product_targeting", "category_targeting", "discovery_test", "defensive"],
          },
          objective: { type: "string" },
          bid_strategy_recommendation: { type: "string" },
          suggested_daily_budget: { type: "number", description: "A reasonable starting daily budget in USD, as a plain suggestion." },
        },
        required: ["campaign_name", "campaign_type", "objective", "bid_strategy_recommendation", "suggested_daily_budget"],
      },
    },
    required: ["keywords", "campaign"],
  },
};

export const POST = withJsonErrors(async (request: Request) => {
  const { project_id } = await request.json();
  if (!project_id) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

  const supabase = await createClient();
  const { user, error: authError, status: authStatus } = await requireApprovedUser(supabase);
  if (!user) return NextResponse.json({ error: authError }, { status: authStatus });

  const [{ data: project }, { data: identity }, { data: metadata }] = await Promise.all([
    supabase.from("projects").select("book_type").eq("id", project_id).single(),
    supabase.from("project_identity").select("working_title, subtitle").eq("project_id", project_id).single(),
    supabase.from("metadata_department").select("description_short, keywords, categories").eq("project_id", project_id).maybeSingle(),
  ]);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const facts = [
    `Book type: ${project.book_type}`,
    identity?.working_title ? `Title: ${identity.working_title}` : null,
    identity?.subtitle ? `Subtitle: ${identity.subtitle}` : null,
    metadata?.description_short ? `Description: ${metadata.description_short}` : null,
    metadata?.categories?.length ? `Categories: ${metadata.categories.join(", ")}` : null,
    metadata?.keywords?.length ? `Existing KDP keywords: ${metadata.keywords.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  type StrategyResult = {
    keywords: { keyword: string; group: string; rationale: string }[];
    campaign: {
      campaign_name: string;
      campaign_type: string;
      objective: string;
      bid_strategy_recommendation: string;
      suggested_daily_budget: number;
    };
  };

  let result: StrategyResult;
  try {
    const generated = await generateStructured<StrategyResult>({
      system:
        "You are InkFrame's Advertising Department, planning an Amazon Ads strategy for a book that already " +
        "exists — everything you need is given below, never ask for more. Produce a mixed keyword list " +
        "(primary/long_tail/buyer_intent/competitor_product_targeting/experimental, plus a couple of negative " +
        "keywords to exclude) and one starter campaign. Everything you produce is a recommendation for the " +
        "author to review, never a live account change. Call the draft_ad_strategy tool.",
      userContent: facts || "No metadata generated yet — use the title/subtitle only.",
      tool: STRATEGY_TOOL,
      maxTokens: 2500,
    });
    result = generated.output;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Strategy generation did not return structured output." },
      { status: 502 }
    );
  }

  const { data: adProject, error: adProjectError } = await supabase
    .from("advertising_projects")
    .upsert({ project_id, status: "strategy_drafted" }, { onConflict: "project_id" })
    .select()
    .single();
  if (adProjectError) return NextResponse.json({ error: adProjectError.message }, { status: 500 });

  const { data: campaign, error: campaignError } = await supabase
    .from("advertising_campaigns")
    .insert({
      advertising_project_id: adProject.id,
      campaign_name: result.campaign.campaign_name,
      campaign_type: result.campaign.campaign_type,
      objective: result.campaign.objective,
      bid_strategy_recommendation: result.campaign.bid_strategy_recommendation,
      status: "draft",
    })
    .select()
    .single();
  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 });

  const { error: keywordsError } = await supabase.from("advertising_keywords").insert(
    result.keywords.map((k) => ({
      campaign_id: campaign.id,
      keyword: k.keyword,
      group: k.group,
      rationale: k.rationale,
    }))
  );
  if (keywordsError) return NextResponse.json({ error: keywordsError.message }, { status: 500 });

  await supabase.from("advertising_recommendations").insert({
    campaign_id: campaign.id,
    issue: "No daily budget set yet.",
    recommendation: `A reasonable starting point is around $${result.campaign.suggested_daily_budget.toFixed(2)}/day — adjust based on your own royalty margin. You set the real budget; InkFrame only suggests one.`,
    user_action: "pending",
  });

  return NextResponse.json({ advertising_project: adProject, campaign, keywords: result.keywords });
});
