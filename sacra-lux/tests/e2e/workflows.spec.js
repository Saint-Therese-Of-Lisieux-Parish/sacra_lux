const { test, expect } = require("@playwright/test");
const sharp = require("sharp");

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

test("App Settings lists Catholic themes first", async ({ page }) => {
  await page.goto(`${baseUrl}/`);
  await expect(page.locator("#massLibraryDialog")).toBeVisible();
  await page.locator("#massLibraryCloseBtn").click();
  await page.locator("#openAppSettingsBtn").click();
  await expect(page.locator("#appSettingsDialog")).toBeVisible();
  await expect(page.locator("#themePicker .theme-swatch")).toHaveCount(22);

  await expect(page.locator("#themePicker .theme-swatch")).toHaveText([
    "Carmel Light",
    "Carmel Dark",
    "Advent",
    "Lenten",
    "Easter",
    "Marian",
    "Sacred Heart",
    "San Juan",
    "Jesuit",
    "Dominican",
    "Franciscan",
    "Benedictine",
    "Light",
    "Dark",
    "Rose",
    "Solarized",
    "Ocean",
    "High Contrast",
    "Nord",
    "Monokai",
    "Stained Glass",
    "Geaux Tigers"
  ]);
});

test("Image Slideshow editor sorts batches and supports persistent ordering controls", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "imageSlideshow:e2e",
        type: "imageSlideshow",
        label: "Announcements",
        phase: "mass",
        backgroundTheme: "light",
        durationSec: 10
      }],
      manualSlides: {
        "imageSlideshow:e2e": {
          images: [],
          slideshowDurationSec: 10,
          slideshowLoopCount: 1
        }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="imageSlideshow:e2e"]').click();
  await expect(page.locator("#editorSectionImageSlideshow")).toBeVisible();

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=", "base64");
  await page.locator("#editorSlideshowFiles").setInputFiles([
    { name: "Zeta.png", mimeType: "image/png", buffer: png },
    { name: "Alpha.png", mimeType: "image/png", buffer: png }
  ]);

  const rows = page.locator("#slideshowImageList .slideshow-image-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);
  await expect(page.locator("#slideshowPreflightSummary")).toContainText("preflight warnings");

  await page.locator("#editorSlideshowDurationSec").fill("2");
  await page.locator("#editorSlideshowLoopCount").fill("2");
  await expect(page.locator("#slideshowRuntimePreview")).toHaveText("10.1s");

  await page.locator("#reverseSlideshowBtn").click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Zeta.png", "2. Alpha.png"]);

  await rows.nth(1).getByRole("button", { name: /Move image up/ }).click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["imageSlideshow:e2e"]?.images?.map((image) => image.name);
  }).toEqual(["Alpha.png", "Zeta.png"]);

  await rows.nth(0).dragTo(rows.nth(1));
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Zeta.png", "2. Alpha.png"]);

  await page.locator("#sortSlideshowBtn").click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);

  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["imageSlideshow:e2e"]?.images?.map((image) => image.name);
  }).toEqual(["Alpha.png", "Zeta.png"]);
});

test("Image Slideshow crossfades between consecutive images", async ({ page, request }) => {
  async function uploadPng(filename, background) {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background }
    }).png().toBuffer();
    const response = await request.post(`${baseUrl}/api/upload-mass-asset`, {
      data: {
        filename,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`
      }
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }

  const first = await uploadPng("First.png", { r: 155, g: 28, b: 49 });
  const second = await uploadPng("Second.png", { r: 28, g: 79, b: 155 });
  await request.post(`${baseUrl}/api/screen-settings`, { data: { transition: "fade" } });
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "imageSlideshow:transition", type: "imageSlideshow", label: "Crossfade", phase: "mass", backgroundTheme: "light" },
        { id: "text:after-transition", type: "text", label: "After", phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: {
        "imageSlideshow:transition": {
          images: [
            { url: first.url, name: "First.png" },
            { url: second.url, name: "Second.png" }
          ],
          slideshowDurationSec: 100,
          slideshowLoopCount: 1
        },
        "text:after-transition": { text: "After the slideshow" }
      }
    }
  });

  await page.goto(`${baseUrl}/screen`);
  await expect(page.locator(`.frame[data-image-url="${first.url}"]`)).toHaveCSS("opacity", "1");
  const stage = page.locator("#stage");
  await page.evaluate(async () => {
    const testSocket = io();
    await new Promise((resolve) => testSocket.on("connect", resolve));
    testSocket.emit("slide:next");
    testSocket.disconnect();
  });
  await expect(stage).toHaveAttribute("data-slideshow-transitioning", "true", { timeout: 3500 });

  const transitionFrames = await page.locator(".frame").evaluateAll((frames) => frames.map((frame) => ({
    imageUrl: frame.dataset.imageUrl,
    opacity: frame.style.opacity
  })));
  expect(transitionFrames).toEqual(expect.arrayContaining([
    { imageUrl: first.url, opacity: "1" },
    { imageUrl: second.url, opacity: "1" }
  ]));

  await expect(stage).toHaveAttribute("data-slideshow-transitioning", "false", { timeout: 1500 });
  await expect(page.locator(`.frame[data-image-url="${second.url}"]`)).toHaveCSS("opacity", "1");
  await expect(page.locator(`.frame[data-image-url="${first.url}"]`)).toHaveCSS("opacity", "0");
});

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
