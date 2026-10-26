const fs = require("fs");
const path = require("path");
const { io: createClient } = require("socket.io-client");
const { test, expect } = require("@playwright/test");

const { createTempHome, dropLoadedServerModules, startIsolatedServer } = require("../helpers/testHarness");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "rehearsal-mass.json"), "utf8")
);

// The timed gathering slides last 4 seconds each in real time, long enough to
// check all three pages before the timer moves on. The server owns
// the timers, and it runs in this process, so a fake clock here would also
// stop Playwright. The phase timers have fake-clock tests in
// tests/integration/phaseTimers.test.js.

let handle;
let baseUrl;
let slides;

async function getState(request) {
  return (await request.get(`${baseUrl}/api/state`)).json();
}

async function dismissRemoteSplash(page) {
  await expect(page.locator("#remoteSplash")).toBeVisible();
  await page.locator("#remoteSplash").click();
  await expect(page.locator("#remoteSplash")).toBeHidden();
}

// The operator UI shows the live output in an embedded copy of the projector
// display. The display keeps two stacked frames and fades between them. The
// visible frame is the one with full opacity, and it carries the slide id.
async function expectStageShows(stageRoot, slide) {
  await expect.poll(
    () => stageRoot.locator("#stage").evaluate((stage) => Array.from(stage.querySelectorAll(".frame"))
      .filter((frame) => getComputedStyle(frame).opacity === "1")
      .map((frame) => frame.dataset.slideId)),
    { message: `visible frame, expected ${slide.id}` }
  ).toEqual([slide.id]);

  const visible = stageRoot.locator(`#stage .frame[data-slide-id="${slide.id}"]`);
  if (slide.type === "image") {
    await expect(visible).toHaveClass(/image-only/);
    return;
  }
  // The display drops the "R." marker from psalm lines.
  // An ending slide holds the spoken ending and no scripture text.
  const shownText = slide.isEndingSlide ? slide.ending : slide.text;
  const firstLine = String(shownText).split("\n").find((line) => line.trim()).replace(/^R\.\s*/, "");
  await expect(visible).toContainText(firstLine);
}

// Check that the server and all three pages show the slide at this index.
async function expectAllShow(index, { request, operator, screen, remote }) {
  const slide = slides[index];
  await expect.poll(async () => (await getState(request)).currentSlideIndex, {
    message: `server index, expected ${index}`
  }).toBe(index);

  await expectStageShows(operator.frameLocator("#screenPreviewFrame"), slide);
  await expectStageShows(screen, slide);
  await expect.poll(async () => {
    const indexes = await remote.locator(".cue-btn.active").evaluateAll(
      (buttons) => buttons.map((button) => Number(button.dataset.index))
    );
    return indexes.includes(index);
  }, { message: `remote cue, expected ${index}` }).toBe(true);
}

test.beforeAll(async () => {
  dropLoadedServerModules();
  const homeDir = createTempHome("sacra-lux-rehearsal-");
  const readingsDir = path.join(homeDir, "readings");
  fs.mkdirSync(readingsDir, { recursive: true });
  for (const [name, contents] of Object.entries(fixture.readings)) {
    fs.writeFileSync(path.join(readingsDir, name), contents, "utf8");
  }
  handle = await startIsolatedServer({ port: 0, homeDir });
  baseUrl = handle.baseUrl;
  fixture.readingsDir = readingsDir;
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
  // Leave no state behind for the specs that run after this one.
  dropLoadedServerModules();
});

test("a full Mass runs the same on the operator UI, projector display, and phone remote", async ({ browser, request }) => {
  test.setTimeout(120_000);
  require("../../src/security").clearRateLimitState();

  const loadRes = await request.post(`${baseUrl}/api/load-readings`, { data: { folderPath: fixture.readingsDir } });
  expect(loadRes.ok()).toBe(true);
  const organizerRes = await request.post(`${baseUrl}/api/organizer`, {
    data: { sequence: fixture.sequence, manualSlides: fixture.manualSlides }
  });
  expect(organizerRes.ok()).toBe(true);

  const initial = await getState(request);
  slides = initial.presentation.slides;

  // R1: the slides follow the saved order.
  const expectedOrder = fixture.sequence.map((item) => item.id);
  const orderOfItems = slides.map((slide) => slide.organizerItemId)
    .filter((id, position, all) => all.indexOf(id) === position);
  expect(orderOfItems).toEqual(expectedOrder);

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const operator = await context.newPage();
  const screen = await context.newPage();
  const remote = await context.newPage();
  await operator.goto(`${baseUrl}/app`);
  if (await operator.locator("#massLibraryDialog").isVisible()) {
    await operator.locator("#massLibraryCloseBtn").click();
  }
  await screen.goto(`${baseUrl}/screen`);
  await remote.goto(`${baseUrl}/remote`);
  await dismissRemoteSplash(remote);
  const pages = { request, operator, screen, remote };

  // R1 and R3: the operator starts the Mass and the gathering timers run.
  await expect(operator.locator("#startGatheringBtn")).toBeVisible();
  const firstGathering = slides.findIndex((slide) => slide.phase === "gathering");
  const firstMass = slides.findIndex((slide) => slide.phase === "mass");
  await operator.locator("#startGatheringBtn").click();
  for (let index = firstGathering; index < firstMass; index += 1) {
    await expectAllShow(index, pages);
  }
  await expectAllShow(firstMass, pages);
  expect((await getState(request)).gatheringRunning).toBe(false);

  // R2 and R4: the phone remote moves all three pages forward and back.
  for (let index = firstMass + 1; index < slides.length; index += 1) {
    await remote.keyboard.press("ArrowRight");
    await expectAllShow(index, pages);
  }
  const last = slides.length - 1;
  await remote.keyboard.press("ArrowLeft");
  await expectAllShow(last - 1, pages);
  await remote.keyboard.press("ArrowRight");
  await expectAllShow(last, pages);

  // R5: extra advances do not move past the last slide.
  await remote.keyboard.press("ArrowRight");
  const socket = createClient(baseUrl, { transports: ["websocket"] });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  socket.emit("slide:next");
  socket.emit("slide:next");
  await new Promise((resolve) => setTimeout(resolve, 500));
  socket.disconnect();
  expect((await getState(request)).currentSlideIndex).toBe(last);
  await expectAllShow(last, pages);

  await context.close();
});
