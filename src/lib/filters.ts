// Pure, data-free helpers: safe to import from Client Components without
// pulling the 500-event dataset into the browser bundle.
import type { Severity } from "./mockData";

export type SeverityFilter = Severity | "all";

export const SEVERITY_OPTIONS: readonly SeverityFilter[] = ["all", "info", "warning", "critical"] as const;

export interface EventFilters {
  search: string;
  severity: SeverityFilter;
}

/** Normalize raw query values (URL or form) into a valid filter object. */
export function parseFilters(raw: { search?: string | string[] | null; severity?: string | string[] | null }): EventFilters {
  const first = (v: string | string[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const severity = first(raw.severity);
  return {
    search: first(raw.search),
    severity: (SEVERITY_OPTIONS as readonly string[]).includes(severity) ? (severity as SeverityFilter) : "all",
  };
}

/** Canonical query string for a filter state (omits defaults so URLs stay clean). */
export function toQueryString({ search, severity }: EventFilters): string {
  const params = new URLSearchParams();
  const trimmed = search.trim();
  if (trimmed) params.set("search", trimmed);
  if (severity !== "all") params.set("severity", severity);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
