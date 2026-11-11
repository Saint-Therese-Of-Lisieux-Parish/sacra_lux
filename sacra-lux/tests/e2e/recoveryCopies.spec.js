const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

let handle;

test.beforeAll(async () => {
  const homeDir = createTempHome("sacra-lux-recovery-e2e-");
  const recoveryDir = path.join(homeDir, ".sacra-lux", "recovery", "mass-one");
  fs.mkdirSync(recoveryDir, { recursive: true });
  fs.writeFileSync(path.join(recoveryDir, "mass.json"), JSON.stringify({
    format: "sacra-lux.mass",
    version: 3,
    metadata: { title: "Recovery" },
    presentationDefaults: {},
    items: []
  }), "utf8");
  handle = await startIsolatedServer({ port: 0, homeDir });
});

test.afterAll(async () => {
  await handle.stop();
});

test("Mass Library lists and downloads a recovery copy", async ({ page }) => {
  await page.goto(`${handle.baseUrl}/app`);
  await expect(page.locator("#massLibraryDialog")).toBeVisible();
  await expect(page.locator("#massRecoveryList")).toContainText("Recovery copies (1)");

  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-recovery-name="mass-one"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("mass-one.zip");
});
