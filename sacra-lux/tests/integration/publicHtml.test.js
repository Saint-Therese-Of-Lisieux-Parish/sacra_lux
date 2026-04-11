const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("public html integration", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-public-html-")
    });
    app = handle.app;
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  test("operator app markup exposes accessible command labels and safe external links", async () => {
    const res = await request(app).get("/").expect(200);

    expect(res.text).toContain('id="massTitleInput"');
    expect(res.text).toContain('aria-label="Mass title"');
    expect(res.text).toContain('<label for="startTimeInput"');
    expect(res.text).toContain('target="_blank" rel="noopener noreferrer"');
  });

  test("start page markup includes a PIN label and live error region", async () => {
    const res = await request(app).get("/start").expect(200);

    expect(res.text).toContain('<label for="pinInput" class="sr-only">PIN Code</label>');
    expect(res.text).toContain('id="errorMsg" class="error-msg" role="status" aria-live="polite"');
  });

  test("remote markup opts into iOS safe-area viewport handling", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain('viewport-fit=cover');
    expect(res.text).toContain('--remote-preview-dock-height');
    expect(res.text).toContain('window.visualViewport?.addEventListener("resize", handleViewportResize);');
  });

  test("remote markup includes the splash overlay summary", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain('id="remoteSplash"');
    expect(res.text).toContain('id="splashMassStart"');
    expect(res.text).toContain('id="splashSlideCount"');
    expect(res.text).toContain("Tap anywhere to open the remote.");
  });

  test("remote markup returns interstitial hold to the centered carousel slide", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain('returnSlideIndex: getCarouselCenterSlideIndex()');
    expect(res.text).toContain('function getCarouselCenterSlideIndex()');
  });

  test("remote markup dismisses the splash and keeps preview-pinning helpers", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain("function dismissSplash()");
    expect(res.text).toContain("els.remoteSplash.addEventListener(\"click\", dismissSplash);");
    expect(res.text).toContain("maintainPreviewPinning(220);");
    expect(res.text).not.toContain('id="titleSection"');
  });
});
