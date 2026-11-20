/**
 * Streaming summary controller + tiny external store.
 *
 * Why an external store instead of useState in the page?
 *   Every streamed token changes `text`. If that state lives in a component
 *   that also renders the event list or the heavy formatter, all of them
 *   re-render ~20x/second. Components read this store through
 *   useSyncExternalStore with a narrow selector (text OR status), so a token
 *   only re-renders the leaf that displays it. No third-party state library.
 *
 * Race-condition guarantees:
 *   - Every start() aborts the previous request (AbortController) AND bumps a
 *     monotonically increasing request id. A chunk is applied only if its
 *     request is still the active one, so even a chunk that was already
 *     resolved in the microtask queue when the abort happened is dropped.
 *   - AbortError is expected control flow: it is caught and swallowed, never
 *     surfaced as an unhandled rejection. start() itself never rejects.
 */

export type StreamStatus = "idle" | "streaming" | "done" | "error";

export interface SummaryState {
  eventId: string | null;
  text: string;
  status: StreamStatus;
  error?: string;
}

export interface SummaryStream {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SummaryState;
  getServerSnapshot(): SummaryState;
  start(eventId: string): Promise<void>;
  cancel(): void;
  reset(): void;
}

const IDLE: SummaryState = Object.freeze({ eventId: null, text: "", status: "idle" }) as SummaryState;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : (err as { name?: string })?.name === "AbortError";
}

export function createSummaryStream(fetchImpl: typeof fetch = (...args) => fetch(...args)): SummaryStream {
  let state: SummaryState = IDLE;
  const listeners = new Set<() => void>();
  const emit = (next: SummaryState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  let seq = 0;
  let active: { id: number; controller: AbortController } | null = null;
  // Completed summaries are cached so A -> B -> A shows A instantly. Partial
  // (aborted) summaries are never cached, so a revisit restarts cleanly.
  const completed = new Map<string, string>();

  function cancel() {
    active?.controller.abort();
    active = null;
  }

  async function start(eventId: string): Promise<void> {
    // Re-clicking the event that is already streaming is a no-op.
    if (state.eventId === eventId && state.status === "streaming" && active) return;

    cancel();

    const cached = completed.get(eventId);
    if (cached !== undefined) {
      emit({ eventId, text: cached, status: "done" });
      return;
    }

    const id = ++seq;
    const controller = new AbortController();
    active = { id, controller };
    const isCurrent = () => active?.id === id && !controller.signal.aborted;

    emit({ eventId, text: "", status: "streaming" });

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetchImpl(`/api/stream-summary?eventId=${encodeURIComponent(eventId)}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!isCurrent()) return;
      if (!res.ok || !res.body) throw new Error(`Summary request failed (HTTP ${res.status})`);

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (!isCurrent()) return; // superseded: drop this chunk and everything after it
        if (done) break;
        text += decoder.decode(value, { stream: true });
        emit({ eventId, text, status: "streaming" });
      }
      text += decoder.decode();
      completed.set(eventId, text);
      emit({ eventId, text, status: "done" });
    } catch (err) {
      if (isAbortError(err) || !isCurrent()) return; // expected cancellation
      emit({
        eventId,
        text: state.eventId === eventId ? state.text : "",
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (active?.id === id) active = null;
      // Release the connection if we bailed out early; ignore "already closed".
      reader?.cancel().catch(() => {});
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => IDLE,
    start,
    cancel,
    reset() {
      cancel();
      emit(IDLE);
    },
  };
}
