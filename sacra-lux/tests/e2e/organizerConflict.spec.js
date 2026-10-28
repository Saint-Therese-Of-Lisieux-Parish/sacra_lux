const { test, expect } = require("@playwright/test");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

const CONFLICT_TEXT = "Another organizer change was saved first. Reload the current state and try again.";

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-organizer-conflict-") });
  baseUrl = handle.baseUrl;
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

test("a stale organizer save keeps the conflict error after reload", async ({ page, request }) => {
  const seed = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "text:kept", type: "text", label: "Kept change", phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: {
        "text:kept": { text: "Kept", notes: "" }
      }
    }
  });
  expect(seed.ok()).toBe(true);

  await page.goto(`${baseUrl}/`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close()));
  await expect(page.locator("#sequenceList")).toContainText("Kept change");

  await page.evaluate(() => {
    socket.disconnect();
    uiState.data.organizerSequence[0].label = "Rejected change";
    uiState.data.organizerRevision = 0;
  });
  await page.locator("#saveOrganizer").click();

  await expect(page.locator("#status")).toHaveText(CONFLICT_TEXT);
  await expect(page.locator("#sequenceList")).toContainText("Kept change");
  await expect(page.locator("#sequenceList")).not.toContainText("Rejected change");

  const state = await (await request.get(`${baseUrl}/api/state`)).json();
  expect(state.organizerSequence[0].label).toBe("Kept change");
});
