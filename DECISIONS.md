# Frontend Architecture & Debugging Decisions

## 1. Root-Cause Diagnosis
What caused each of the three reported issues in the starter codebase?

- **Stream cross-contamination:** `handleSelectEvent` started a `fetch` + `reader.read()` loop with **no `AbortController` and no request identity**. Clicking B called `setSummaryText("")` and started a second loop, but A's loop kept running and kept calling `setSummaryText(prev => prev + chunk)`. Both loops appended to the same state, so the functional updater interleaved A's and B's tokens. A's loop finishing also ran `setIsStreaming(false)` while B was still streaming. On the server, the route had no `cancel()` hook and only polled `request.signal` between tokens, so an aborted client left a timer running that could `enqueue()` into a closed stream.
- **Duplicate fetches & broken history navigation:** three cascading effects formed a feedback loop.
  (1) *state → URL*: `router.push` on every `search`/`severity` change. That includes **mount**, which pushed a redundant `/?` entry and an extra RSC navigation. It also ran on **every keystroke** with no debounce, so Back stepped through one entry per character.
  (2) *URL → state*: an effect on `searchParams` wrote the URL back into state. While typing, the URL lags behind the input, so this effect overwrote newer keystrokes with older URL values, which effect 1 then pushed again (ping-pong). On Back/Forward, effect 2 copied the popped URL into state and effect 1 immediately **pushed it as a new entry**, wiping the forward stack. That's why "Back is broken".
  (3) *fetch*: an un-debounced `fetch('/api/events')` per state change, plus one on mount (the page was fully client-side, so it had no initial data). It had no cancellation or ordering, so with the route's 150–550 ms jitter, **out-of-order responses** could render stale results for an older query.
  Separately, the whole page was `'use client'` and called `useSearchParams()` with no Suspense boundary, so **`next build` failed** (CSR-bailout prerender error).
- **Render cascade during streaming:** `summaryText` lived in the top-level page component, so each token (every ~45 ms) re-rendered the entire page: 500 un-memoized rows with fresh inline closures and the un-memoized `HeavyPayloadFormatter`, whose render alone burns ~12 ms. `HeavyPayloadFormatter` also took `summaryText` as a prop, so even memoizing it would not have helped. The main thread was busy for most of each 45 ms window, so keystrokes and scrolling queued behind renders.

## 2. Server vs. Client Component Boundaries
Which parts did you move to Server Components vs. keep as Client Components, and why? What serializable props cross the boundary?

**Server Components**
- `app/layout.tsx`: document shell.
- `app/page.tsx`: `async` page. It awaits `searchParams`, parses filters, and calls `filterEvents()` directly. That avoids an HTTP round-trip to its own API, so the first paint already contains the correct, filtered rows, and there is **no client fetch on mount**. It also renders the static layout (grid, panes, section landmarks, Suspense boundary). Filter changes re-render this component via App Router navigation, so the URL drives the data.
- The dataset (`mockData.ts`) and `lib/queryEvents.ts` are only imported by server code, so the 500-event generator never ships to the browser. The pure helpers that the client needs (`parseFilters`, `toQueryString`) live in a separate, data-free `lib/filters.ts`. The page's client JS is ~3.5 kB.

**Client Components (interactive islands only)**
- `WorkspaceProvider`: the one piece of cross-pane client state (which event is selected) plus the streaming controller. Server-rendered layout passes *through* it as `children`, so the shell stays an RSC.
- `FilterBar`: input, select, `useSearchParams`/`useRouter`, wrapped in `<Suspense>` with a static server fallback.
- `EventList` / memoized `EventRow`: click handlers and selection highlight. Rows are real `<button>`s, which also makes them keyboard-accessible.
- `SummaryDrawer`, `StreamStatus`, `SummaryOutput`, `HeavyPayloadFormatter`: streaming UI.

**Props crossing the boundary:** `EventList` gets `events: SystemEvent[]`, plain objects of strings (`id`, `timestamp`, `service`, `severity`, `title`, `rawPayload`). `WorkspaceProvider` gets `children`, server-rendered React elements. That's all. `FilterBar` reads its state from the URL itself, so no filter props are threaded through.
*Trade-off:* every filter navigation sends the filtered rows in the RSC payload (≤ ~100 KB for all 500 rows). At larger scale I'd paginate or virtualize, and send `rawPayload` only for the selected event.

## 3. Stream Cancellation & Race-Condition Strategy
How did you guarantee that rapid clicks never interleave chunks or throw unhandled `AbortError`s? What happens with Event A → B → A?

All streaming goes through one controller (`lib/summaryStream.ts`), created once per workspace:
1. **Abort the previous request.** Every `start(id)` calls `abort()` on the previous `AbortController` before starting a new fetch, which cancels the network request and the reader.
2. **Request-identity guard.** Each start gets a monotonically increasing request id. After every `await` (fetch, each `reader.read()`), the loop checks `isCurrent()` and stops if it has been superseded. This matters because abort alone isn't enough: a chunk that already resolved in the microtask queue before the abort would otherwise still be applied. Stale chunks are dropped, never appended.
3. **`AbortError` is control flow, not an error.** It is caught and swallowed inside the controller. `start()` never rejects, and callers use `void stream.start(id)`. A `finally` block cancels the reader to release the connection, ignoring "already closed".
4. **Server side:** the route now implements `cancel()` and an `abort` listener that clears the pending timer and stops producing, so aborted streams don't leak timers or throw on `enqueue`.
5. **Lifecycle:** streams also abort when the workspace unmounts, and when a filter change removes the selected event from the list (the drawer is cleared, so stale output never lingers for an event the user can no longer see). If the selected event is still visible after a filter change, its stream keeps going. It's the same event, so nothing can bleed. Re-clicking the event that is already streaming is a no-op.

**A → B → A quickly:** A starts (req 1) → B aborts req 1 and starts req 2 → A aborts req 2 and starts a **fresh** req 3. Partial summaries are never cached, so A restarts from an empty panel, and any late chunk from req 1 or req 2 fails the `isCurrent()` check. The panel shows exactly one complete summary for A. If A had *finished* before, its completed summary is cached and shown instantly with no new request.

Verified in a headless-Chrome run (`scripts/verify-e2e.mjs`): a 7-click sequence at 120 ms intervals ends with only the last event's summary; A→B→A shows one complete A summary; there are zero console errors or unhandled rejections.

## 4. State Synchronization & Render Performance
- **How did you synchronize filter inputs with `useSearchParams` / `router.push` without a `useEffect` feedback loop?**
  The URL is the single source of truth for *committed* filters, and each direction of data flow is one-way:
  - **URL → UI:** `severity` is read straight from `useSearchParams()` (no local copy). The search box keeps a local `draft` so typing is instant, and it is reconciled with the URL **during render** (React's "adjust state when a prop changes" pattern), not in an effect. When the URL's `search` changes, we compare it with the last value *we* committed. If it matches, the change was our own navigation, so the draft is left alone; this preserves keystrokes typed while the navigation was in flight. If it differs, it was Back/Forward or a link, so the draft takes the URL's value.
  - **UI → URL:** user events only. Severity changes commit immediately, together with the current draft so they produce a single history entry. Search commits after a 300 ms debounce (or immediately on Enter). The debounce is a timer effect keyed on `draft`, and it returns early whenever `draft === committedSearch`, which is always true right after an external URL change. So URL updates never schedule a push, and there is no loop.
  - `router.push` (inside `startTransition`, which drives an "Updating…" indicator) makes each committed state a history entry, so Back/Forward walk through filter states. A commit whose canonical query string equals the current URL is skipped, so there's no redundant navigation or history entry.
  - The navigation *is* the data fetch: the App Router requests the page's RSC payload for the new URL, and the router keeps only the latest navigation. That gives one request per committed change and none on mount. `/api/events` is kept for API consumers but the dashboard no longer calls it.
  - Verified: 7 fast keystrokes cause exactly 1 navigation request; a severity change causes exactly 1; Back → Back → Forward restores the input value, the select value and the row counts each time; no extra navigation fires after Back/Forward; and keystrokes typed during an in-flight navigation are preserved.
- **How did you verify that token updates in the summary panel no longer trigger re-renders in the event table?**
  - **Architecture:** token text lives in an external store read through `useSyncExternalStore` with narrow selectors. Only `SummaryOutput` subscribes to `text`, and `StreamStatus` subscribes to `status`, so it re-renders once at the start and once at the end. `EventList`, `FilterBar` and `SummaryDrawer` don't subscribe at all. The store object reaches them through a context whose value never changes. `HeavyPayloadFormatter` is `React.memo`'d and receives the summary leaf as a *stable* `children` element (memoized in the drawer) instead of a `summaryText` prop, so it re-renders only when `rawPayload` changes.
  - **Built-in render counters:** every major component shows a commit counter that writes directly to the DOM in an effect, so displaying it never causes a render. The e2e script reads them before and after a full stream. Measured during one complete summary stream: **Event list +0, Filter bar +0, Drawer +0, Summary output +54**.
  - **Main-thread check:** a `PerformanceObserver('longtask')` running during streaming records **0 tasks over 50 ms**. In the starter, every token triggered a render of 12 ms or more.
  - To confirm manually: in React DevTools, turn on "Highlight updates when components render" (or record with the Profiler) while a summary streams. Only the summary text should update.

## Other notes
- **Next.js 15.0.3 → 15.0.8:** 15.0.3 is affected by CVE-2025-66478 (critical RCE in the RSC protocol, fixed from 15.0.5). I took the latest patch release on the same 15.0.x line, so there are no API changes.
- No new runtime dependencies were added. Only native React (`useSyncExternalStore`, `useTransition`, `memo`, context) and App Router primitives are used.
