const { test, expect } = require("@playwright/test");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

// The only hosts the pages may request. Every other host is an external
// request and fails the test. Keep this list in one place.
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

const PAGES = ["/", "/app", "/screen", "/remote", "/start"];

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-offline-") });
  baseUrl = handle.baseUrl;
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

function isLocalUrl(rawUrl) {
  const url = new URL(rawUrl);
  // data: and blob: URLs never leave the browser.
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") {
    return true;
  }
  return LOCAL_HOSTNAMES.has(url.hostname);
}

// Abort each external request and record it. The context stays online for
// the local server only, which models a parish with no Internet.
async function blockExternalRequests(context) {
  const blocked = [];
  await context.route("**/*", (route) => {
    const requestUrl = route.request().url();
    if (isLocalUrl(requestUrl)) {
      return route.continue();
    }
    blocked.push(requestUrl);
    return route.abort("internetdisconnected");
  });
  return blocked;
}

for (const route of PAGES) {
  test(`${route} makes no external request`, async ({ context, page }) => {
    const blocked = await blockExternalRequests(context);
    // The Content-Security-Policy header stops an external resource before it
    // reaches the network. Count that refusal as an external request too.
    const refused = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) {
        refused.push(message.text());
      }
    });
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    expect(blocked).toEqual([]);
    expect(refused).toEqual([]);
  });
}

test("operator UI and projector display load with no Internet", async ({ context, page }) => {
  const blocked = await blockExternalRequests(context);

  await page.goto(`${baseUrl}/app`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#newMassBtn")).toBeVisible();

  const screen = await context.newPage();
  await screen.goto(`${baseUrl}/screen`);
  await screen.waitForLoadState("networkidle");
  await expect(screen.locator("body")).toBeVisible();

  expect(blocked).toEqual([]);
});
