"use client";

import React, { memo } from "react";

/**
 * Simulates an expensive markdown / syntax highlighting component.
 *
 * Changes from the starter:
 *  - Wrapped in React.memo, so it only re-renders when `rawPayload` (or the
 *    `children` element identity) changes.
 *  - The streaming summary is no longer a `summaryText` string prop (which
 *    forced this ~12 ms render on every token). Instead the summary *leaf* is
 *    passed in as `children`. React re-renders that child on its own when its
 *    store subscription fires, without re-running this component.
 */
export const HeavyPayloadFormatter = memo(function HeavyPayloadFormatter({
  rawPayload,
  children,
}: {
  rawPayload: string;
  children: React.ReactNode;
}) {
  // Simulate ~12ms of synchronous formatting work per render
  const start = performance.now();
  let checksum = 0;
  while (performance.now() - start < 12) {
    checksum = (checksum + 1) % 1000;
  }

  return (
    // data-checksum depends on wall-clock timing (it only exists so the busy
    // loop isn't optimized away), so server and client values always differ.
    // suppressHydrationWarning scopes the exception to this one attribute.
    <div data-checksum={checksum} suppressHydrationWarning style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div
        style={{
          background: "#1e293b",
          padding: "14px",
          borderRadius: "8px",
          border: "1px solid #334155",
          whiteSpace: "pre-wrap",
          lineHeight: 1.55,
          minHeight: "180px",
        }}
      >
        {children}
      </div>
      <details open>
        <summary style={{ cursor: "pointer", color: "#94a3b8", fontSize: "13px" }}>Raw Telemetry Payload</summary>
        <pre
          style={{
            background: "#020617",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "12px",
            overflowX: "auto",
          }}
        >
          {rawPayload}
        </pre>
      </details>
    </div>
  );
});
