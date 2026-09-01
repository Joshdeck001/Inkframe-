import { NextResponse } from "next/server";

/**
 * Guarantees an API route always returns valid JSON, even when something
 * throws that isn't otherwise caught — a Supabase call erroring in a way
 * that isn't `{ data, error }`, a network failure, whatever. Without this,
 * an uncaught throw returns Vercel's own error page (or an empty body),
 * and the browser's `response.json()` fails with a confusing "Unexpected
 * end of JSON input" instead of a real error message.
 */
export function withJsonErrors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      return await handler(request);
    } catch (e) {
      console.error("Unhandled API error:", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Something went wrong on the server." },
        { status: 500 }
      );
    }
  };
}
