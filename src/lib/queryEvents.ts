import { ALL_EVENTS, type SystemEvent } from "./mockData";
import type { EventFilters } from "./filters";

/**
 * Single source of truth for filtering, shared by the RSC page and the
 * /api/events route. Server-only by convention (imports the dataset); Client
 * Components must import from ./filters instead.
 */
export function filterEvents({ search, severity }: EventFilters): SystemEvent[] {
  const needle = search.toLowerCase().trim();
  return ALL_EVENTS.filter((evt) => {
    const matchesSeverity = severity === "all" || evt.severity === severity;
    const matchesSearch =
      !needle ||
      evt.title.toLowerCase().includes(needle) ||
      evt.service.toLowerCase().includes(needle) ||
      evt.id.toLowerCase().includes(needle);
    return matchesSeverity && matchesSearch;
  });
}
