/**
 * Server Component: owns initial data loading and the static shell.
 *
 *  - Reads `search` / `severity` from the URL and filters on the server, so the
 *    first paint already contains the right rows and there is no client fetch
 *    on mount (no duplicate requests, no loading flash, nothing to race).
 *  - When the client changes filters it navigates (router.push); the App
 *    Router re-requests this component's RSC payload for the new URL, which
 *    makes navigation the one and only data fetch per filter change. Back and
 *    Forward replay those navigations.
 *  - Only interactive islands are Client Components: FilterBar, EventList,
 *    SummaryDrawer, and the WorkspaceProvider that connects list and drawer.
 *    The layout markup below is passed through the provider as children and
 *    stays server-rendered.
 */
import { Suspense } from "react";
import { parseFilters } from "@/lib/filters";
import { filterEvents } from "@/lib/queryEvents";
import { WorkspaceProvider } from "@/components/WorkspaceProvider";
import { FilterBar, FilterBarFallback } from "@/components/FilterBar";
import { EventList } from "@/components/EventList";
import { SummaryDrawer } from "@/components/SummaryDrawer";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);
  const events = filterEvents(filters);

  return (
    <WorkspaceProvider>
      <main style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", height: "100vh", overflow: "hidden" }}>
        {/* Left pane: filters & event feed */}
        <section
          aria-label="Event log"
          style={{ borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          <Suspense fallback={<FilterBarFallback />}>
            <FilterBar />
          </Suspense>
          <EventList events={events} />
        </section>

        {/* Right pane: streaming AI incident drawer */}
        <section aria-label="Incident summary" style={{ padding: "20px", overflowY: "auto" }}>
          <SummaryDrawer />
        </section>
      </main>
    </WorkspaceProvider>
  );
}
