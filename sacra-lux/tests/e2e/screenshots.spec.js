const { test, expect } = require("@playwright/test");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

// Baselines come from the Linux CI runner. Fonts are bundled in public/fonts,
// but text rendering still differs by operating system.
test.skip(process.platform !== "linux" && !process.env.SCREENSHOTS_ANY_OS, "Screenshot baselines exist for Linux only.");

const RESOLUTIONS = ["720p", "1080p", "1440p", "4k"];

// A 16:9 viewport avoids letterbox bars. The stage scales to fit it.
test.use({ viewport: { width: 1280, height: 720 } });

const SHOT_OPTIONS = { animations: "disabled" };

const PARAGRAPH = [
  "The Lord is my shepherd; there is nothing I shall want.",
  "In verdant pastures he gives me repose.",
  "Beside restful waters he leads me;",
  "he refreshes my soul."
].join("\n");

let handle;
let baseUrl;

test.beforeAll(async () => {
  handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-shots-") });
  baseUrl = handle.baseUrl;
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

async function showSlides(request, settings, slides) {
  const settingsResponse = await request.post(`${baseUrl}/api/screen-settings`, { data: settings });
  expect(settingsResponse.ok()).toBe(true);
  const organizerResponse = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: slides.map((slide) => ({
        id: slide.id,
        type: "text",
        label: slide.id,
        phase: "mass",
        backgroundTheme: slide.backgroundTheme
      })),
      manualSlides: Object.fromEntries(slides.map((slide) => [slide.id, { text: PARAGRAPH }]))
    }
  });
  expect(organizerResponse.ok()).toBe(true);
}

async function openScreen(page, resolution) {
  await page.goto(`${baseUrl}/screen`);
  // Hide the web-mode fullscreen prompt so the shot shows only the slide.
  await page.addStyleTag({ content: "#fullscreenPrompt { display: none !important; }" });
  const stage = page.locator("#stage");
  await expect(stage).toBeVisible();
  await expect(page.locator("#stage .frame").first()).toContainText("The Lord is my shepherd");
  await page.evaluate(() => document.fonts.ready);
  const widths = { "720p": 1280, "1080p": 1920, "1440p": 2560, "4k": 3840 };
  await expect.poll(() => page.evaluate(() => window.__frameW)).toBe(widths[resolution]);
  return stage;
}

for (const resolution of RESOLUTIONS) {
  for (const backgroundTheme of ["dark", "light"]) {
    test(`/screen ${backgroundTheme} text slide at ${resolution}`, async ({ page, request }) => {
      await showSlides(request, { resolution, transition: "none" }, [{ id: `shot-${backgroundTheme}`, backgroundTheme }]);
      await openScreen(page, resolution);
      await expect(page).toHaveScreenshot(`screen-${backgroundTheme}-${resolution}.png`, SHOT_OPTIONS);
    });
  }
}

test("/screen settles on the same picture after a fade as with no transition", async ({ page, request }) => {
  await showSlides(request, { resolution: "1080p", transition: "fade" }, [
    { id: "fade-first", backgroundTheme: "light" },
    { id: "fade-second", backgroundTheme: "dark" }
  ]);
  await openScreen(page, "1080p");
  await page.evaluate(async () => {
    const testSocket = io();
    await new Promise((resolve) => testSocket.on("connect", resolve));
    const advanced = new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      testSocket.on("state:update", (state) => {
        if (Number(state?.currentSlideIndex) >= 1) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    testSocket.emit("slide:next");
    await advanced;
    testSocket.disconnect();
  });
  // The fade lasts 0.7 s. Wait until only one frame is visible.
  await expect.poll(() => page.locator("#stage .frame").evaluateAll(
    (frames) => frames.filter((frame) => Number(getComputedStyle(frame).opacity) > 0).length
  )).toBe(1);
  await expect(page).toHaveScreenshot("screen-after-fade-1080p.png", SHOT_OPTIONS);
});
