const { test, expect } = require("@playwright/test");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({
    port: 0,
    homeDir: createTempHome("sacra-lux-remote-start-")
  });
  baseUrl = handle.baseUrl;
  await fetch(`${baseUrl}/api/organizer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sequence: [
        { id: "text:mass", type: "text", label: "Mass", phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: { "text:mass": { text: "Mass" } }
    })
  });
  await fetch(`${baseUrl}/api/start-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
  });
});

test.afterAll(async () => {
  if (handle) await handle.stop();
});

test("remote shows a server error when no pre-Mass slides exist", async ({ page }) => {
  await page.goto(`${baseUrl}/remote#start-pre-mass`);
  await expect(page.locator("#remoteStatusMessage")).toHaveText("No pre-mass slides found. Add slides with section 'Pre-Mass' first.");
});
