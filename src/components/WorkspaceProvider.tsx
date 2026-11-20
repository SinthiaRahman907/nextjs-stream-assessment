"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SystemEvent } from "@/lib/mockData";
import { createSummaryStream, type SummaryState, type SummaryStream } from "@/lib/summaryStream";

interface SelectionContextValue {
  selected: SystemEvent | null;
  select: (evt: SystemEvent) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);
// The store object itself never changes, so consumers of this context never
// re-render because of it; they subscribe to slices via useSummary().
const StreamContext = createContext<SummaryStream | null>(null);

/**
 * Client boundary that owns cross-pane state (which event is selected) and the
 * single streaming controller. Server-rendered shell markup is passed through
 * as `children`, so it stays a Server Component.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [stream] = useState(createSummaryStream);
  const [selected, setSelected] = useState<SystemEvent | null>(null);

  // Starting the stream is a side effect of a user action, so it happens in the
  // event handler (not in an effect that reacts to `selected`).
  const select = useCallback(
    (evt: SystemEvent) => {
      setSelected(evt);
      void stream.start(evt.id);
    },
    [stream]
  );

  const clear = useCallback(() => {
    setSelected(null);
    stream.reset();
  }, [stream]);

  // Abort any in-flight stream if the workspace unmounts (e.g. route change).
  useEffect(() => () => stream.cancel(), [stream]);

  const selection = useMemo(() => ({ selected, select, clear }), [selected, select, clear]);

  return (
    <StreamContext.Provider value={stream}>
      <SelectionContext.Provider value={selection}>{children}</SelectionContext.Provider>
    </StreamContext.Provider>
  );
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <WorkspaceProvider>");
  return ctx;
}

/** Subscribe to one slice of the stream state. Select primitives so unrelated changes don't re-render. */
export function useSummary<T extends string | null | undefined>(selector: (s: SummaryState) => T): T {
  const stream = useContext(StreamContext);
  if (!stream) throw new Error("useSummary must be used inside <WorkspaceProvider>");
  return useSyncExternalStore(
    stream.subscribe,
    () => selector(stream.getSnapshot()),
    () => selector(stream.getServerSnapshot())
  );
}
