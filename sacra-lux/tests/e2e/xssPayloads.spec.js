const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const { test, expect } = require("@playwright/test");

const {
  createTempHome,
  dropLoadedServerModules,
  loadReadingsFolderOverHttp,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

// Every payload sets a flag if the browser runs it. Every payload also carries a
// data-xss-probe attribute, so a payload that becomes a real element is found.
const FLAG = "window.__xssFired = (window.__xssFired || 0) + 1";
const PAYLOADS = [
  `<img data-xss-probe src=x onerror="${FLAG}">`,
  `<script data-xss-probe>${FLAG}</script>`,
  `"><svg data-xss-probe onload="${FLAG}">`,
  `<a data-xss-probe href="javascript:${FLAG}">click</a>`,
  `<iframe data-xss-probe srcdoc="<script>parent.${FLAG}</script>"></iframe>`
];
const HOSTILE = PAYLOADS.join(" ");
// A Mass title becomes a folder name, so it stays short. See issue #321.
const HOSTILE_TITLE = PAYLOADS[2];

let handle;
let baseUrl;

test.beforeAll(async () => {
  dropLoadedServerModules();
  const homeDir = createTempHome("sacra-lux-xss-");
  makeReadingsFolder(homeDir);
  handle = await startIsolatedServer({ port: 0, homeDir });
  baseUrl = handle.baseUrl;
});

test.beforeEach(() => {
  require("../../src/security").clearRateLimitState();
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
  // Leave no state behind for the specs that run after this one.
  dropLoadedServerModules();
});

function watchPage(page) {
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|refused to (execute|load|run)/i.test(message.text())) {
      problems.push(`CSP: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

async function expectInert(page, problems) {
  // Let any queued error handler or load event run before the checks.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__xssFired || 0)).toBe(0);
  expect(await page.locator("[data-xss-probe]").count()).toBe(0);
  expect(await page.locator("a[href^='javascript:' i]").count()).toBe(0);
  expect(problems).toEqual([]);
}

async function expectShownAsText(page, selector) {
  // The probe attribute must appear literally, which proves the text was escaped.
  await expect.poll(async () => {
    const texts = await page.locator(selector).allTextContents();
    return texts.some((text) => text.includes("data-xss-probe"));
  }).toBe(true);
}

async function loadHostileOrganizer(request) {
  const res = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "text:xss", type: "text", label: HOSTILE, phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: {
        "text:xss": { text: HOSTILE, notes: HOSTILE, textVAlign: "middle", imageUrl: null }
      }
    }
  });
  expect(res.ok()).toBe(true);
  const titleRes = await request.post(`${baseUrl}/api/update-title`, { data: { title: HOSTILE_TITLE } });
  expect(titleRes.ok()).toBe(true);
}

async function openOperator(page) {
  await page.goto(`${baseUrl}/app`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
}

test("operator UI shows hostile organizer text as plain text", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const problems = watchPage(page);
  await loadHostileOrganizer(request);
  await openOperator(page);

  await expectShownAsText(page, "#sequenceList");
  await expectInert(page, problems);
});

test("operator UI keeps a hostile image URL out of the organizer markup", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const hostileUrl = `/api/mass-asset/a"><img data-xss-probe src=x onerror="${FLAG}">.png`;
  const res = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "image:xss", type: "image", label: "Image", phase: "mass", backgroundTheme: "light" }
      ],
      manualSlides: { "image:xss": { imageUrl: hostileUrl } }
    }
  });
  expect(res.ok()).toBe(true);
  await page.goto(`${baseUrl}/app`);

  // This test reads the page with evaluate. WebKit locators wait on the pending image load.
  await expect.poll(() => page.evaluate(
    () => document.querySelectorAll("#sequenceList .sequence-item").length
  ), { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => ({
    fired: window.__xssFired || 0,
    probes: document.querySelectorAll("[data-xss-probe]").length
  }));
  expect(result).toEqual({ fired: 0, probes: 0 });
});

test("projector display shows hostile slide text as plain text", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const problems = watchPage(page);
  await loadHostileOrganizer(request);
  await page.goto(`${baseUrl}/screen`);

  await expectShownAsText(page, "body");
  await expectInert(page, problems);
});

test("phone remote shows hostile slide text as plain text", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const problems = watchPage(page);
  await loadHostileOrganizer(request);
  await page.goto(`${baseUrl}/remote`);

  await expectShownAsText(page, "#splashTitle, #cueList");
  await expectInert(page, problems);
  await page.locator("#remoteSplash").click();
  await expectShownAsText(page, "#cueList");
  await expectInert(page, problems);
});

test("readings folder text and title show as plain text on all three pages", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const problems = watchPage(page);
  const folder = path.join(createTempHome("sacra-lux-xss-readings-"), "readings");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "mass_title.txt"), HOSTILE_TITLE, "utf8");
  fs.writeFileSync(path.join(folder, "Reading_I.txt"), `${HOSTILE}\n\n${HOSTILE}`, "utf8");
  fs.writeFileSync(path.join(folder, "Gospel.txt"), `${HOSTILE}\n\n${HOSTILE}`, "utf8");
  const res = await loadReadingsFolderOverHttp(request, baseUrl, folder);
  expect(res.ok()).toBe(true);

  for (const route of ["/app", "/screen", "/remote"]) {
    await page.goto(`${baseUrl}${route}`);
    await expectShownAsText(page, "body");
    await expectInert(page, problems);
  }
});

test("ZIP names and mass.json fields show as plain text on all three pages", async ({ page, request }) => {
  await page.addInitScript(() => { window.__xssFired = 0; });
  const problems = watchPage(page);
  const zip = new AdmZip();
  zip.addFile("mass.json", Buffer.from(JSON.stringify({
    format: "sacra-lux.mass",
    version: 3,
    metadata: { title: HOSTILE_TITLE },
    items: [
      {
        id: "hymn-xss",
        kind: "hymn",
        label: HOSTILE,
        section: "mass",
        durationSec: 10,
        notes: HOSTILE,
        content: { text: HOSTILE },
        presentation: { background: "dark" }
      }
    ]
  })));
  zip.addFile(`assets/${PAYLOADS[0].replace(/[/\\]/g, "_")}.txt`, Buffer.from("hostile name"));
  const res = await request.post(`${baseUrl}/api/import-mass-zip`, {
    data: { zipData: `data:application/zip;base64,${zip.toBuffer().toString("base64")}` }
  });
  // The import may refuse the odd asset name. The mass.json fields still load or the whole import fails closed.
  if (!res.ok()) {
    const zipOnly = new AdmZip();
    zipOnly.addFile("mass.json", zip.getEntry("mass.json").getData());
    const retry = await request.post(`${baseUrl}/api/import-mass-zip`, {
      data: { zipData: `data:application/zip;base64,${zipOnly.toBuffer().toString("base64")}` }
    });
    expect(retry.ok()).toBe(true);
  }

  for (const route of ["/app", "/screen", "/remote"]) {
    await page.goto(`${baseUrl}${route}`);
    await expectShownAsText(page, "body");
    await expectInert(page, problems);
  }
});
