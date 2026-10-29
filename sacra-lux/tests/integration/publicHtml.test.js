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

  test("operator app exposes the locked control message and unlock action", async () => {
    const res = await request(app).get("/").expect(200);

    expect(res.text).toContain('id="controlLockBanner"');
    expect(res.text).toContain("Locked: enter the PIN to control.");
    expect(res.text).toContain('id="unlockControlBtn"');
    expect(res.text).toContain('socket.on("control:required"');
    expect(res.text).toContain("openPinDialogForUnlock");
    expect(res.text).toContain("if (response.status === 401) showControlLocked()");
  });

  test("operator app supports drag-and-drop media imports into announcement sections", async () => {
    const res = await request(app).get("/").expect(200);

    expect(res.text).toContain('data-folder-import-phase');
    expect(res.text).toContain('"/api/import-slideshow-images"');
    expect(res.text).toContain("function importSingleMedia");
    expect(res.text).toContain("function importImageFiles");
    expect(res.text).toContain("Drop one or more images, an MP4, or an image folder");
    expect(res.text).not.toContain("phase-folder-import-btn");
    expect(res.text).not.toContain("phaseFolderImportFiles");
  });

  test("start page markup includes a PIN label and live error region", async () => {
    const stateRes = await request(app).get("/api/state").expect(200);
    if (!stateRes.body.hasStartPin) {
      await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
    }
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

  test("remote markup shows unlock and connection status controls", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain('id="remoteStatus" class="remote-status" role="status" aria-live="polite"');
    expect(res.text).toContain('id="remoteUnlockLink" href="/start" hidden');
    expect(res.text).toContain('socket.on("control:required"');
    expect(res.text).toContain('showRemoteStatus(error || "Unlock the remote to control slides.", { showUnlock: true })');
    expect(res.text).toContain("let remoteControlLocked = false;");
    expect(res.text).toContain("if (!remoteControlLocked) {");
    expect(res.text).toContain('socket.on("control:ok", () => {');
    expect(res.text).toContain('socket.emit("control:auth", { token: "" });');
    expect(res.text).toContain('socket.on("disconnect"');
    expect(res.text).toContain('showRemoteStatus("Disconnected. Waiting for the server to reconnect.")');
    expect(res.text).toContain('socket.on("connect"');
  });

  test("remote markup has no Blackout, Start Mass, or Interstitial Slide quick actions", async () => {
    const res = await request(app).get("/remote").expect(200);

    for (const id of ["blackoutBtn", "interstitialBtn", "nextSectionBtn", "blackSection"]) {
      expect(res.text).not.toContain(`id="${id}"`);
    }
    expect(res.text).not.toContain('socket.emit("screen:black"');
    expect(res.text).not.toContain(">Blackout<");
    expect(res.text).not.toContain(">Interstitial Slide<");
    expect(res.text).not.toContain("Start Mass");
    expect(res.text).toContain('id="screenFrame"');
    expect(res.text).toContain('id="cueList"');
  });

  test("remote markup dismisses the splash and keeps preview-pinning helpers", async () => {
    const res = await request(app).get("/remote").expect(200);

    expect(res.text).toContain("function dismissSplash()");
    expect(res.text).toContain("els.remoteSplash.addEventListener(\"click\", dismissSplash);");
    expect(res.text).toContain("maintainPreviewPinning(220);");
    expect(res.text).not.toContain('id="titleSection"');
  });

  test("screen markup preserves the branded default backgrounds for blank interstitials", async () => {
    const res = await request(app).get("/screen").expect(200);

    expect(res.text).toContain("/static/assets/default-text-background.avif");
    expect(res.text).toContain("/static/assets/default-interstitial.png");
    expect(res.text).toContain('frame.style.removeProperty("--bg-light")');
  });
});
