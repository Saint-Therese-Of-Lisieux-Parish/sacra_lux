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

// Open each operator dialog and scan only that dialog. A dialog that opens
// from a button uses the button. A dialog that needs a loaded Mass or an
// open slide opens with showModal(), because the scan targets its markup.
const DIALOGS = [
  { id: "massLibraryDialog", button: null },
  { id: "newMassDialog", button: "#newMassBtn" },
  { id: "settingsDialog", button: "#openSettingsBtn" },
  { id: "appSettingsDialog", button: "#openAppSettingsBtn" },
  { id: "screenDialog", button: null },
  { id: "pinDialog", button: null },
  { id: "duplicateDialog", button: null },
  { id: "pdfExportDialog", button: null },
  { id: "editorDialog", button: null }
];

for (const { id, button } of DIALOGS) {
  test(`#${id} has no WCAG 2.1 A or AA axe violations when open`, async ({ page }) => {
    await page.goto(`${baseUrl}/`);
    await page.waitForLoadState("networkidle");
    // The Mass library opens on load. Close any open dialog first.
    await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close()));

    if (button) {
      await page.locator(button).click();
    } else {
      await page.evaluate((dialogId) => document.getElementById(dialogId).showModal(), id);
    }
    await expect(page.locator(`#${id}`)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include(`#${id}`)
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
