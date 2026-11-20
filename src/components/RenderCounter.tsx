"use client";

import { useEffect, useRef } from "react";

/**
 * Counts *commits* of the component that renders it, and writes the number
 * straight into the DOM, so displaying the counter never causes a render.
 *
 * Note: if React StrictMode is enabled, effects mount twice in development, so
 * a counter may start at 2. After that, each increment is one real re-render.
 */
export function useRenderCounter(label: string) {
  const count = useRef(0);
  const span = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    count.current += 1;
    if (span.current) span.current.textContent = `${label} renders: ${count.current}`;
  });
  return span;
}

export function RenderBadge({ spanRef }: { spanRef: React.RefObject<HTMLSpanElement> }) {
  return (
    <span
      ref={spanRef}
      data-testid="render-counter"
      style={{ fontSize: "11px", color: "#64748b", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
    />
  );
}
