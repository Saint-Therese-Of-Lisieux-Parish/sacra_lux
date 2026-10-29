const { test, expect } = require("@playwright/test");

const { state } = require("../../src/state");
const { clearRateLimitState, createPinHashRecord } = require("../../src/security");
const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

let handle;
let baseUrl;
let previousStartPinHash;

test.beforeAll(async () => {
  handle = await startIsolatedServer({
    port: 0,
    homeDir: createTempHome("sacra-lux-locked-operator-")
  });
  baseUrl = handle.baseUrl;
  previousStartPinHash = state.startPinHash;
  state.startPinHash = createPinHashRecord("123456");
});

test.beforeEach(() => {
  clearRateLimitState();
});

test.afterAll(async () => {
  state.startPinHash = previousStartPinHash;
  if (handle) await handle.stop();
});

for (const route of ["/", "/app"]) {
  test(`${route} does not retry locked bounds previews`, async ({ page, request }) => {
    const apiRequests = [];
    const apiResponses = [];
    page.on("request", (requestEvent) => {
      if (new URL(requestEvent.url()).pathname.startsWith("/api/")) {
        apiRequests.push(requestEvent.url());
      }
    });
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/")) {
        apiResponses.push(response.status());
      }
    });

    await page.goto(`${baseUrl}${route}`);
    await page.waitForTimeout(1000);

    expect(apiRequests.length).toBeLessThanOrEqual(15);
    expect(apiResponses).not.toContain(429);
    expect(apiRequests.filter((url) => url.endsWith("/api/preview-reading")).length).toBeLessThanOrEqual(1);

    const unlockResponse = await request.post(`${baseUrl}/api/verify-pin`, {
      data: { pin: "123456" }
    });
    expect(unlockResponse.status()).toBe(200);
  });
}
