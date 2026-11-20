// Usage: npm run build && npm start   (in another terminal)
//        npm i --no-save playwright && npx playwright install chromium
//        node scripts/verify-e2e.mjs        (BASE=http://localhost:3000 by default)
// End-to-end verification of the frontend acceptance criteria against `next start`.
import pw from "playwright";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:3000";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  —  " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const page = await browser.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text() + " @ " + JSON.stringify(m.location()));
});

page.on("response", (r) => { if (r.status() >= 400) pageErrors.push(`HTTP ${r.status()} ${r.url()}`); });
const requests = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  const isRsc = r.headers()["rsc"] === "1" || u.searchParams.has("_rsc");
  if (u.pathname.startsWith("/api/events")) requests.push({ kind: "api-events", url: r.url() });
  else if (isRsc && u.pathname === "/") requests.push({ kind: "rsc", url: r.url() });
  else if (u.pathname.startsWith("/api/stream-summary")) requests.push({ kind: "stream", url: r.url() });
});

const counter = async (label) => {
  const txt = await page.locator(`[data-testid=render-counter]`, { hasText: `${label} renders:` }).first().textContent();
  return Number(txt.split(":")[1]);
};
const summaryText = () => page.locator('[aria-live="polite"]').last().textContent();
const row = (id) => page.locator("li button", { hasText: id });

// ---------------------------------------------------------------- 1. mount
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await sleep(300);
check("No client data fetch on mount", requests.filter((r) => r.kind !== "stream").length === 0, JSON.stringify(requests));
check("500 events server-rendered", (await page.locator("li button").count()) === 500);

// ------------------------------------------- 2. rapid switching / stream bleed
requests.length = 0;
const ids = ["evt_0001", "evt_0002", "evt_0003", "evt_0002", "evt_0004", "evt_0001", "evt_0005"];
for (const id of ids) {
  await row(id).click();
  await sleep(120); // mid-stream (cold start 250ms + 45ms/token)
}
const finalId = ids[ids.length - 1];
await page.locator("text=Streaming tokens...").waitFor({ state: "detached", timeout: 15000 });
const text = await summaryText();
const foreign = ["evt_0001", "evt_0002", "evt_0003", "evt_0004"].filter((id) => text.includes(id));
check(
  "Rapid A/B/C switching: final summary only contains final event",
  text.includes(`Incident Analysis for ${finalId}`) && foreign.length === 0 && text.split("### ").length === 2,
  `final=${finalId} foreign=${JSON.stringify(foreign)}`
);
check("Header shows final event", (await page.locator("h2").textContent()).includes(finalId));

// A -> B -> A quickly
await row("evt_0010").click();
await sleep(100);
await row("evt_0011").click();
await sleep(100);
await row("evt_0010").click();
await page.locator("text=Streaming tokens...").waitFor({ state: "detached", timeout: 15000 });
const aba = await summaryText();
check(
  "A -> B -> A: shows only A, complete, no duplication",
  aba.includes("evt_0010") && !aba.includes("evt_0011") && aba.split("### ").length === 2 && aba.trim().endsWith("cluster."),
  aba.slice(0, 60).replace(/\n/g, " ")
);

// Cached revisit of a completed summary is instant (no new stream request)
requests.length = 0;
await row("evt_0005").click();
await sleep(50);
check("Revisit of completed summary served from cache", requests.filter((r) => r.kind === "stream").length === 0 && (await summaryText()).includes("evt_0005"));

// --------------------------------------------------------- 3. render isolation
await row("evt_0020").click();
await page.locator("text=Streaming tokens...").waitFor({ timeout: 5000 });
await sleep(400); // let the selection-change renders settle
const before = { list: await counter("Event list"), filter: await counter("Filter bar"), drawer: await counter("Drawer"), out: await counter("Summary output") };
await page.locator("text=Streaming tokens...").waitFor({ state: "detached", timeout: 15000 });
const after = { list: await counter("Event list"), filter: await counter("Filter bar"), drawer: await counter("Drawer"), out: await counter("Summary output") };
check(
  "Streaming re-renders only the summary leaf",
  after.list === before.list && after.filter === before.filter && after.drawer === before.drawer && after.out - before.out > 10,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
);

// Measure main-thread responsiveness while streaming: typing latency
await row("evt_0030").click();
await page.locator("text=Streaming tokens...").waitFor({ timeout: 5000 });
const longTasks = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const tasks = [];
      const obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(Math.round(e.duration))));
      obs.observe({ type: "longtask", buffered: false });
      setTimeout(() => {
        obs.disconnect();
        resolve(tasks);
      }, 1500);
    })
);
check("No long tasks (>50ms) on main thread during streaming", longTasks.length === 0, JSON.stringify(longTasks));
await page.locator("text=Streaming tokens...").waitFor({ state: "detached", timeout: 15000 });

// --------------------------------------------------- 4. URL-driven filters
requests.length = 0;
const input = page.locator('input[aria-label="Filter events"]');
await input.click();
await input.pressSequentially("billing", { delay: 40 }); // 7 keystrokes, faster than debounce
await page.waitForURL(/search=billing/, { timeout: 5000 });
await sleep(800);
const rscAfterTyping = requests.filter((r) => r.kind === "rsc").length;
check("Debounced search: 7 keystrokes -> exactly 1 navigation fetch", rscAfterTyping === 1, `rsc=${rscAfterTyping}`);
check("No /api/events calls (data via RSC navigation)", requests.filter((r) => r.kind === "api-events").length === 0);
const billingCount = await page.locator("li button").count();
check("Search filtered list", billingCount === 100, `rows=${billingCount}`);

requests.length = 0;
await page.selectOption('select[aria-label="Severity"]', "critical");
await page.waitForURL(/severity=critical/, { timeout: 5000 });
await sleep(500);
check("Severity change -> exactly 1 navigation fetch", requests.filter((r) => r.kind === "rsc").length === 1);
check("URL has both params", page.url().includes("search=billing") && page.url().includes("severity=critical"), page.url());
check("Search+severity filtered list", (await page.locator("li button").count()) === 15);

// Back / Forward
await page.goBack();
await page.waitForURL((u) => !u.search.includes("severity"), { timeout: 5000 });
await sleep(400);
check(
  "Back #1 restores search-only state (input, select, rows)",
  (await input.inputValue()) === "billing" &&
    (await page.locator('select[aria-label="Severity"]').inputValue()) === "all" &&
    (await page.locator("li button").count()) === 100,
  page.url()
);
await page.goBack();
await page.waitForURL((u) => u.search === "", { timeout: 5000 });
await sleep(400);
check("Back #2 restores unfiltered state", (await input.inputValue()) === "" && (await page.locator("li button").count()) === 500, page.url());
await page.goForward();
await page.waitForURL(/search=billing/, { timeout: 5000 });
await sleep(400);
check("Forward re-applies search", (await input.inputValue()) === "billing" && (await page.locator("li button").count()) === 100);
await sleep(600);
check("No stray navigation after Back/Forward (no feedback loop)", !page.url().includes("severity") && page.url().includes("search=billing"), page.url());

// Typing during a pending navigation is not clobbered
await input.fill("");
await input.pressSequentially("auth", { delay: 30 });
await sleep(320); // debounce fires, navigation in flight
await input.pressSequentially("-gateway", { delay: 30 });
await page.waitForURL(/search=auth-gateway/, { timeout: 5000 });
await sleep(400);
check("Keystrokes typed during navigation are preserved", (await input.inputValue()) === "auth-gateway", await input.inputValue());

// Deep link
await page.goto(`${BASE}/?search=edge&severity=warning`, { waitUntil: "networkidle" });
check(
  "Deep link hydrates inputs from URL",
  (await input.inputValue()) === "edge" && (await page.locator('select[aria-label="Severity"]').inputValue()) === "warning"
);

// --------------------------- 5. filter change while streaming (selected filtered out)
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await row("evt_0001").click();
await page.locator("text=Streaming tokens...").waitFor({ timeout: 5000 });
await page.selectOption('select[aria-label="Severity"]', "critical"); // evt_0001 is critical (i=0) -> stays
await page.waitForURL(/severity=critical/);
await sleep(300);
const stillStreaming = await page.locator("text=Streaming tokens...").count();
await page.selectOption('select[aria-label="Severity"]', "info"); // evt_0001 filtered out -> abort + clear
await page.waitForURL(/severity=info/);
await sleep(1500);
const afterClear = await summaryText();
check("Filter keeping selected event: stream continues", stillStreaming === 1);
check(
  "Filter removing selected event: stream aborted, drawer cleared, no late chunks",
  afterClear.startsWith("Select an event") && (await page.locator("h2").textContent()) === "Incident Summary",
  afterClear.slice(0, 40)
);

// ------------------------------------------------------------- errors
const relevant = pageErrors.filter((e) => !/favicon/.test(e));
check("No page errors / unhandled AbortError in console", relevant.length === 0, JSON.stringify(relevant));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
