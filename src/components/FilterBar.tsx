"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseFilters, SEVERITY_OPTIONS, toQueryString, type EventFilters, type SeverityFilter } from "@/lib/filters";
import { RenderBadge, useRenderCounter } from "./RenderCounter";

const SEARCH_DEBOUNCE_MS = 300;

const SEVERITY_LABELS: Record<SeverityFilter, string> = {
  all: "All Severities",
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

const controlStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#f8fafc",
};

/**
 * The URL is the single source of truth for committed filters.
 *
 *  - Data flows one way per direction, never in a loop:
 *      user input --(debounced handler)--> router.push --> URL --> RSC re-render (new events)
 *      URL (Back/Forward/link) --(adjust state during render)--> input draft
 *  - Only the in-progress search *draft* is local state, so typing is instant
 *    while navigation (and therefore data loading) happens once per pause.
 */
export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = parseFilters({ search: searchParams.get("search"), severity: searchParams.get("severity") });

  const [draft, setDraft] = useState(url.search);
  // The last URL search value this component has reconciled against.
  const [seenUrlSearch, setSeenUrlSearch] = useState(url.search);
  // The last search value *we* pushed. Lets us tell our own navigation
  // (don't touch the draft: the user may have kept typing) apart from external
  // navigation like Back/Forward (replace the draft with the URL value).
  const [committedSearch, setCommittedSearch] = useState(url.search);
  const [isPending, startTransition] = useTransition();
  const counter = useRenderCounter("Filter bar");

  // URL -> state, done during render (React's "adjusting state when a prop
  // changes" pattern) instead of in an effect, so there is no extra render
  // pass and no effect that could write back to the URL.
  if (url.search !== seenUrlSearch) {
    setSeenUrlSearch(url.search);
    if (url.search !== committedSearch) {
      setDraft(url.search);
      setCommittedSearch(url.search);
    }
  }

  const currentQuery = toQueryString(url);
  const commit = useCallback(
    (next: EventFilters) => {
      setCommittedSearch(next.search.trim());
      const nextQuery = toQueryString(next);
      if (nextQuery === currentQuery) return; // no-op: no navigation, no fetch, no history entry
      // push (not replace): every committed filter state is a history entry,
      // so Back/Forward walk through them. Debouncing keeps it to one entry
      // per typing pause rather than one per keystroke.
      startTransition(() => router.push(`${pathname}${nextQuery}`, { scroll: false }));
    },
    [currentQuery, pathname, router]
  );

  // State -> URL for the search box, debounced. This is a one-way timer, not
  // a sync loop: after a commit (or an external URL change) draft ===
  // committedSearch, so the effect returns early and schedules nothing.
  useEffect(() => {
    if (draft.trim() === committedSearch) return;
    const t = setTimeout(() => commit({ search: draft, severity: url.severity }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, committedSearch, url.severity, commit]);

  return (
    <div
      role="search"
      style={{ padding: "16px", borderBottom: "1px solid #1e293b", display: "flex", gap: "12px", alignItems: "center" }}
    >
      <input
        type="search"
        aria-label="Filter events"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit({ search: draft, severity: url.severity }); // skip the debounce
        }}
        placeholder="Filter by service, title, or ID..."
        style={{ ...controlStyle, flex: 1 }}
      />
      <select
        aria-label="Severity"
        value={url.severity}
        // Commit the current draft together with the severity so a pending
        // search isn't lost or committed as a separate history entry.
        onChange={(e) => commit({ search: draft, severity: e.target.value as SeverityFilter })}
        style={controlStyle}
      >
        {SEVERITY_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {SEVERITY_LABELS[s]}
          </option>
        ))}
      </select>
      <span aria-live="polite" style={{ fontSize: "12px", color: "#38bdf8", minWidth: "62px" }}>
        {isPending ? "Updating…" : ""}
      </span>
      <RenderBadge spanRef={counter} />
    </div>
  );
}

/** Static placeholder rendered on the server while FilterBar's search params resolve. */
export function FilterBarFallback() {
  return (
    <div style={{ padding: "16px", borderBottom: "1px solid #1e293b", display: "flex", gap: "12px" }}>
      <input disabled placeholder="Filter by service, title, or ID..." style={{ ...controlStyle, flex: 1 }} />
      <select disabled style={controlStyle}>
        <option>All Severities</option>
      </select>
    </div>
  );
}
