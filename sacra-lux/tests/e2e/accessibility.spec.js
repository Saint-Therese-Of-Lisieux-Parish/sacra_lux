const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

const { state } = require("../../src/state");
const { createPinHashRecord } = require("../../src/security");
const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

const PAGES = ["/", "/app", "/screen", "/remote", "/start"];

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-a11y-") });
  baseUrl = handle.baseUrl;
  // Set a PIN so /start renders its page and does not redirect to /remote.
  state.startPinHash = createPinHashRecord("123456");
});

test.afterAll(async () => {
  state.startPinHash = null;
  if (handle) {
    await handle.stop();
  }
});

for (const route of PAGES) {
  test(`${route} has no WCAG 2.1 A or AA axe violations`, async ({ page }) => {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    // Guard against a redirect that would test the wrong page.
    expect(new URL(page.url()).pathname).toBe(route);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const summary = results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(" "))
    }));
    expect(summary).toEqual([]);
  });
}
