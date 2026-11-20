"use client";

import React, { useMemo } from "react";
import { HeavyPayloadFormatter } from "./HeavyPayloadFormatter";
import { useSelection, useSummary } from "./WorkspaceProvider";
import { RenderBadge, useRenderCounter } from "./RenderCounter";

/**
 * Drawer chrome. Re-renders only when the selected event changes; it reads no
 * streaming state itself.
 */
export function SummaryDrawer() {
  const { selected } = useSelection();
  const counter = useRenderCounter("Drawer");
  // Stable element identity, so the memoized formatter isn't invalidated by
  // `children` when the drawer re-renders for reasons other than the payload.
  const summarySlot = useMemo(() => <SummaryOutput />, []);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>{selected ? `Analysis: ${selected.id}` : "Incident Summary"}</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <StreamStatus />
          <RenderBadge spanRef={counter} />
        </div>
      </div>
      <HeavyPayloadFormatter rawPayload={selected?.rawPayload || "{}"}>{summarySlot}</HeavyPayloadFormatter>
    </>
  );
}

/** Leaf: subscribes only to `status`, so it re-renders at most a few times per stream. */
function StreamStatus() {
  const status = useSummary((s) => s.status);
  const error = useSummary((s) => s.error);
  if (status === "streaming") return <span style={{ fontSize: "12px", color: "#38bdf8" }}>Streaming tokens...</span>;
  if (status === "error")
    return (
      <span role="alert" style={{ fontSize: "12px", color: "#f87171" }}>
        {error ?? "Stream failed"}
      </span>
    );
  return null;
}

/** Leaf: the ONLY component that re-renders per streamed token. */
function SummaryOutput() {
  const text = useSummary((s) => s.text);
  const counter = useRenderCounter("Summary output");
  return (
    <>
      <div style={{ textAlign: "right", marginBottom: 6 }}>
        <RenderBadge spanRef={counter} />
      </div>
      <div aria-live="polite">{text || "Select an event to generate an AI incident analysis..."}</div>
    </>
  );
}
