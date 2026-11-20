import { NextRequest } from "next/server";
import { ALL_EVENTS } from "@/lib/mockData";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId") || "evt_0001";
  const event = ALL_EVENTS.find((e) => e.id === eventId) || ALL_EVENTS[0];

  const report = [
    `### Incident Analysis for ${event.id} (${event.service})\n\n`,
    `**Severity:** ${event.severity.toUpperCase()} | **Detected:** ${event.timestamp}\n\n`,
    `**Root Cause Assessment:** Telemetry from \`${event.service}\` indicates elevated tail latency correlated with connection pool saturation. `,
    `Automatic retries amplified downstream concurrency by 3.2x during the observation window.\n\n`,
    `**Recommended Remediation:**\n`,
    `1. Enforce bounded concurrency semaphore on outbound worker tasks.\n`,
    `2. Verify idempotency keys before replaying failed webhook deliveries.\n`,
    `3. Check node memory pressure on \`eu-south-1a\` cluster.\n`,
  ].join("");

  const tokens = report.split(" ");
  const encoder = new TextEncoder();

  // Stop producing as soon as the client goes away. The original loop only
  // polled request.signal between tokens and had no cancel() hook, so after a
  // client abort it kept a timer running and could call enqueue() on a
  // cancelled stream ("Invalid state: Controller is already closed").
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const stop = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    wake?.();
  };
  request.signal.addEventListener("abort", stop, { once: true });

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Initial model cold-start delay
        await sleep(250);
        for (const word of tokens) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(word + " "));
          await sleep(45);
        }
        if (!cancelled) controller.close();
      } catch {
        // Stream was torn down underneath us; nothing left to do.
      } finally {
        request.signal.removeEventListener("abort", stop);
      }
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
