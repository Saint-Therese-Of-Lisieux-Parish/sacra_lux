const { test, expect } = require("@playwright/test");

const { clearRateLimitState } = require("../../src/security");
const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-keyboard-") });
  baseUrl = handle.baseUrl;
});

test.beforeEach(() => {
  clearRateLimitState();
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

test("focused controls keep Enter and Space and the body keeps slide shortcuts", async ({ page, request }) => {
  const organizerResponse = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "text:first", type: "text", label: "First", phase: "mass", backgroundTheme: "dark" },
        { id: "text:second", type: "text", label: "Second", phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: {
        "text:first": { text: "First", notes: "" },
        "text:second": { text: "Second", notes: "" }
      }
    }
  });
  expect(organizerResponse.ok()).toBe(true);

  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close()));

  const newMassButton = page.locator("#newMassBtn");
  await newMassButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#newMassDialog")).toBeVisible();
  await expect(page.locator("#editorDialog")).toBeHidden();
  await page.locator("#newMassCancelBtn").click();

  const beforeSpace = await (await request.get(`${baseUrl}/api/state`)).json();
  await newMassButton.focus();
  await page.keyboard.press(" ");
  await expect(page.locator("#newMassDialog")).toBeVisible();
  const afterSpace = await (await request.get(`${baseUrl}/api/state`)).json();
  expect(afterSpace.currentSlideIndex).toBe(beforeSpace.currentSlideIndex);
  await page.locator("#newMassCancelBtn").click();

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await (await request.get(`${baseUrl}/api/state`)).json()).currentSlideIndex).toBe(1);
});
