import { NextRequest, NextResponse } from "next/server";
import { parseFilters } from "@/lib/filters";
import { filterEvents } from "@/lib/queryEvents";

/**
 * JSON API kept for external consumers. The dashboard itself no longer calls
 * it: the page is a Server Component that filters on the server directly
 * (no self-HTTP round-trip), and filter changes re-render it via URL navigation.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters = parseFilters({ search: searchParams.get("search"), severity: searchParams.get("severity") });

  // Simulate realistic network jitter (150ms - 550ms) so out-of-order responses happen naturally
  const delay = 150 + Math.floor(Math.random() * 400);
  await new Promise((r) => setTimeout(r, delay));

  const filtered = filterEvents(filters);
  return NextResponse.json({ events: filtered, total: filtered.length });
}
