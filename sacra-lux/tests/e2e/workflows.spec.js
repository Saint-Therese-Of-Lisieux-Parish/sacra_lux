const { test, expect } = require("@playwright/test");

const {
  createTempHome,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

let handle;
let baseUrl;
let readingsPath;

test.beforeAll(async () => {
  const homeDir = createTempHome("sacra-lux-e2e-");
  readingsPath = makeReadingsFolder(homeDir);
  handle = await startIsolatedServer({ port: 0, homeDir });
  baseUrl = handle.baseUrl;
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

test("remote next button advances active slide", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:first",
          type: "text",
          label: "Intro",
          phase: "mass",
          backgroundType: "color"
        },
        {
          id: "text:second",
          type: "text",
          label: "Prayer",
          phase: "mass",
          backgroundType: "color"
        }
      ],
      manualSlides: {
        "text:first": { text: "Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:second": { text: "Slide Two", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/remote`);
  await expect(page.locator("#title")).toContainText(/Mass Presentation|No presentation/i);

  await page.locator("#nextBtn").click();

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return json.currentSlideIndex;
  }).toBe(1);
});

test("remote selecting a post-mass slide starts the post-mass loop from that slide", async ({ page, request }) => {
  const organizerRes = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:mass",
          type: "text",
          label: "Homily Notes",
          phase: "mass",
          backgroundType: "color"
        },
        {
          id: "text:post-one",
          type: "text",
          label: "Post One",
          phase: "post",
          backgroundType: "color",
          durationSec: 1
        },
        {
          id: "text:post-two",
          type: "text",
          label: "Post Two",
          phase: "post",
          backgroundType: "color",
          durationSec: 1
        }
      ],
      manualSlides: {
        "text:mass": { text: "Mass Slide", notes: "", textVAlign: "middle", imageUrl: null },
        "text:post-one": { text: "Post Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:post-two": { text: "Post Slide Two", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });
  expect(organizerRes.ok()).toBeTruthy();

  await page.goto(`${baseUrl}/remote`);
  await page.getByRole("button", { name: "Post Two" }).click();

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return {
      currentSlideIndex: json.currentSlideIndex,
      postMassRunning: json.postMassRunning
    };
  }).toEqual({ currentSlideIndex: 2, postMassRunning: true });

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return json.currentSlideIndex;
  }, { timeout: 5000 }).toBe(1);

  const stopRes = await request.post(`${baseUrl}/api/post-mass/stop`);
  expect(stopRes.ok()).toBeTruthy();
});

test("start page validates PIN-gated mass start flow", async ({ page, request }) => {
  const setPin = await request.post(`${baseUrl}/api/start-pin`, {
    data: { pin: "1234" }
  });
  expect(setPin.ok()).toBeTruthy();

  await page.goto(`${baseUrl}/start`);
  await page.fill("#pinInput", "9999");
  await page.click("#startBtn");
  await expect(page.locator("#errorMsg")).toContainText("Incorrect PIN");

  await page.fill("#pinInput", "1234");
  await page.click("#startBtn");
  await page.waitForURL(/\/remote/);
});

test("Sacra Lux can load readings and expose slides in state", async ({ page, request }) => {
  await page.goto(`${baseUrl}/`);
  await expect(page.locator("#status")).toBeVisible();

  const loadRes = await request.post(`${baseUrl}/api/load-readings`, {
    data: {
      folderPath: readingsPath
    }
  });
  expect(loadRes.ok()).toBeTruthy();

  await expect.poll(async () => {
    const stateRes = await request.get(`${baseUrl}/api/state`);
    const json = await stateRes.json();
    return json.presentation.slides.length;
  }).toBeGreaterThan(0);
});
