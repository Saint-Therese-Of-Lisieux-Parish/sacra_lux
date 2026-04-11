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

async function dismissRemoteSplash(page) {
  await expect(page.locator("#remoteSplash")).toBeVisible();
  await page.locator("#remoteSplash").click();
  await expect(page.locator("#remoteSplash")).toBeHidden();
}

test("remote splash dismisses into preview-first layout and arrow next advances slide", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:first",
          type: "text",
          label: "Intro",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:second",
          type: "text",
          label: "Prayer",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:first": { text: "Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:second": { text: "Slide Two", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/remote`);
  await expect(page.locator("#splashTitle")).toContainText(/Mass Presentation|No presentation/i);
  await dismissRemoteSplash(page);
  await expect(page.locator("#titleSection")).toHaveCount(0);
  await expect(page.locator("#previewDock")).toBeVisible();
  await expect(page.locator("#previewCarousel")).toBeVisible();

  await page.keyboard.press("ArrowRight");

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
          backgroundTheme: "dark"
        },
        {
          id: "text:post-one",
          type: "text",
          label: "Post One",
          phase: "post",
          backgroundTheme: "dark",
          durationSec: 1
        },
        {
          id: "text:post-two",
          type: "text",
          label: "Post Two",
          phase: "post",
          backgroundTheme: "dark",
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
  await dismissRemoteSplash(page);
  await page.getByRole("button", { name: "Post Two" }).evaluate((button) => button.click());

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

test("remote preview interaction keeps the large preview pinned at the top", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:first",
          type: "text",
          label: "Intro",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:second",
          type: "text",
          label: "Prayer",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:third",
          type: "text",
          label: "Dismissal",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:first": { text: "Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:second": { text: "Slide Two", notes: "", textVAlign: "middle", imageUrl: null },
        "text:third": { text: "Slide Three", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/remote`);
  await dismissRemoteSplash(page);
  await page.evaluate(() => {
    document.querySelector("#cueList")?.scrollTo({ top: 9999 });
  });
  await page.locator("#carouselTrack").click({ position: { x: 20, y: 20 } });

  const previewBox = await page.locator("#previewDock").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox.y).toBeLessThan(2);
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
