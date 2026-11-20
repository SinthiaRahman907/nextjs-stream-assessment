"use client";

import React, { memo, useEffect } from "react";
import type { SystemEvent } from "@/lib/mockData";
import { useSelection } from "./WorkspaceProvider";
import { RenderBadge, useRenderCounter } from "./RenderCounter";

const SEVERITY_BG: Record<SystemEvent["severity"], string> = {
  critical: "#7f1d1d",
  warning: "#78350f",
  info: "#1e3a8a",
};

/**
 * Receives the already-filtered events from the Server Component page as a
 * serializable prop. It does not subscribe to the streaming store, so streamed
 * tokens never re-render it. It re-renders only when the list (filters) or the
 * selection changes, and then memoized rows skip unless their own props changed.
 */
export function EventList({ events }: { events: SystemEvent[] }) {
  const { selected, select, clear } = useSelection();
  const counter = useRenderCounter("Event list");
  const selectedId = selected?.id ?? null;

  // If a filter change removes the selected event from view, abort its stream
  // and clear the drawer, so stale output never lingers for an event the user
  // can no longer see. This effect performs a side effect (network abort),
  // which is what effects are for.
  useEffect(() => {
    if (selectedId && !events.some((e) => e.id === selectedId)) clear();
  }, [events, selectedId, clear]);

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          background: "#0f172a",
          padding: "8px 16px",
          borderBottom: "1px solid #1e293b",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "12px",
          color: "#94a3b8",
        }}
      >
        <span>{events.length} events</span>
        <RenderBadge spanRef={counter} />
      </div>
      {events.length === 0 && <div style={{ padding: "16px", color: "#94a3b8" }}>No events match these filters.</div>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {events.map((evt) => (
          <EventRow key={evt.id} evt={evt} selected={evt.id === selectedId} onSelect={select} />
        ))}
      </ul>
    </div>
  );
}

const EventRow = memo(function EventRow({
  evt,
  selected,
  onSelect,
}: {
  evt: SystemEvent;
  selected: boolean;
  onSelect: (evt: SystemEvent) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(evt)}
        aria-pressed={selected}
        style={{
          all: "unset",
          boxSizing: "border-box",
          width: "100%",
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          cursor: "pointer",
          background: selected ? "#1e293b" : "transparent",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: "14px", fontWeight: 500 }}>{evt.title}</div>
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            {evt.id} · {evt.timestamp}
          </div>
        </div>
        <span
          style={{
            fontSize: "11px",
            padding: "2px 8px",
            borderRadius: "999px",
            background: SEVERITY_BG[evt.severity],
            color: "#f8fafc",
          }}
        >
          {evt.severity}
        </span>
      </button>
    </li>
  );
});
