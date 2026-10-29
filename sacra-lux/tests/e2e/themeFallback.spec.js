const { test, expect } = require("@playwright/test");

const AxeBuilder = require("@axe-core/playwright").default;
const { state } = require("../../src/state");
const { createPinHashRecord } = require("../../src/security");
const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({
    port: 0,
    homeDir: createTempHome("sacra-lux-theme-fallback-")
  });
  baseUrl = handle.baseUrl;
  state.startPinHash = createPinHashRecord("123456");
});

test.afterAll(async () => {
  state.startPinHash = null;
  if (handle) await handle.stop();
});

for (const route of ["/", "/app", "/start"]) {
  test(`${route} keeps accessible fallback colors when theme loading fails`, async ({ page }) => {
    await page.route("**/api/theme-vars", (requestRoute) => requestRoute.fulfill({ status: 429, body: "{}" }));
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.filter((violation) => violation.id === "color-contrast")).toEqual([]);
  });
}

for (const route of ["/", "/start"]) {
  test(`${route} retries theme loading after a failed request`, async ({ page }) => {
    let themeRequests = 0;
    await page.clock.install();
    await page.route("**/api/theme-vars", async (requestRoute) => {
      themeRequests += 1;
      if (themeRequests === 1) {
        await requestRoute.fulfill({ status: 429, body: "{}" });
        return;
      }
      await requestRoute.continue();
    });

    await page.goto(`${baseUrl}${route}`);
    await page.clock.fastForward(60000);
    await expect.poll(() => themeRequests).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim())).toBe("#6e5442");
  });
}
