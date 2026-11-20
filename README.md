# Frontend Technical Assessment — Event Log & Live AI Summary Workspace

## Context
You are taking over an internal operations dashboard built with **Next.js (App Router)**, **React**, and **TypeScript**. The workspace displays a filterable list of 500 system events on the left and a live streaming AI incident-summary drawer on the right.

Users are reporting three major issues in production:
1. **Stream Cross-Contamination:** Clicking Event A starts a streaming summary; clicking Event B before Event A finishes causes leftover chunks from Event A to bleed into Event B's summary panel.
2. **Sluggish Typing & Broken Back Button:** Typing in the search box or toggling severity filters triggers duplicate API calls and breaks browser Back/Forward navigation.
3. **UI Jank During Streaming:** While a summary is streaming tokens, typing or scrolling feels sluggish because the entire 500-row table and heavy syntax formatter re-render on every single streamed chunk.

## Setup
```bash
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

## Acceptance Criteria
1. **Zero Stream Bleed:** Rapidly switching between events (or changing filters while a stream is active) must cleanly abort in-flight streams and never append stale chunks to the newly selected event.
2. **URL-Driven Filter State:** `search` and `severity` filters must stay synchronized with URL query parameters (`?search=...&severity=...`) with **no duplicate fetches** on mount/change, proper debouncing on search input, and working browser Back/Forward navigation.
3. **Render Isolation:** Streaming token updates must **only** re-render the leaf summary output component—never the 500-row event list or filter bar (verifiable via React DevTools Profiler or the built-in render counters).
4. **Server/Client Boundary Hygiene:** Move initial data loading and shell layout to React Server Components where appropriate instead of making the entire page `'use client'`.

## Constraints
- **No external state or data-fetching libraries:** Do not install Zustand, Redux, Jotai, TanStack Query, or SWR. Solve state and cancellation using native React and Next.js App Router primitives.
- Complete `DECISIONS.md` before submitting.

---

## Solution Overview
See [`DECISIONS.md`](DECISIONS.md) for the root-cause analysis and design rationale.

| Concern | Where | Approach |
|---|---|---|
| Initial data + shell | `src/app/page.tsx` (Server Component) | Reads `searchParams`, filters on the server, renders layout; no client fetch on mount |
| URL-driven filters | `src/components/FilterBar.tsx` | URL is the source of truth; debounced `router.push`; URL→draft reconciled during render (no effect loop); Back/Forward work |
| Stream cancellation | `src/lib/summaryStream.ts` | `AbortController` + monotonically increasing request id; stale chunks dropped; `AbortError` swallowed |
| Render isolation | `WorkspaceProvider.tsx`, `SummaryDrawer.tsx` | Tokens live in an external store read via `useSyncExternalStore`; only the summary leaf subscribes; memoized formatter and rows |
| Server stream hygiene | `src/app/api/stream-summary/route.ts` | `cancel()` + abort listener stop the producer immediately |

Each panel shows a live **render counter**, so render isolation is visible while a summary streams.

### Verification
```bash
npm run build && npm start                      # terminal 1
npm i --no-save playwright && npx playwright install chromium
node scripts/verify-e2e.mjs                     # terminal 2: 23 end-to-end checks
```
Next.js was bumped from 15.0.3 to 15.0.8 (CVE-2025-66478 fix, same minor line).
