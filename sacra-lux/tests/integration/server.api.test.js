const fs = require("fs");
const http = require("http");
const path = require("path");
const AdmZip = require("adm-zip");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("server api integration", () => {
  let handle;
  let app;
  let warnSpy;
  let resetSecurityState;
  let state;
  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=";

  function extractTokenFromRedirect(redirectPath) {
    const match = String(redirectPath || "").match(/token=([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  beforeAll(async () => {
    jest.resetModules();
    const homeDir = createTempHome("sacra-lux-int-");
    handle = await startIsolatedServer({ port: 0, homeDir });
    app = handle.app;
    app.set("trust proxy", true);
    ({ resetSecurityState } = require("../../src/security"));
    ({ state } = require("../../src/state"));
  });

  beforeEach(() => {
    resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  afterEach(() => {
    if (warnSpy) warnSpy.mockRestore();
  });

  test("state endpoint omits raw PIN value", async () => {
    await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.hasStartPin).toBe(true);
    expect(stateRes.body.startPin).toBeUndefined();
  });

  test("theme endpoints list Catholic themes first", async () => {
    const expectedCatholicIds = [
      "carmelite",
      "carmeliteDark",
      "advent",
      "lenten",
      "easter",
      "marian",
      "sacredHeart",
      "sanJuan",
      "jesuit",
      "dominican",
      "franciscan",
      "benedictine"
    ];

    const themesRes = await request(app).get("/api/themes").expect(200);
    const themeVarsRes = await request(app).get("/api/theme-vars").expect(200);

    expect(themesRes.body.themes.slice(0, expectedCatholicIds.length).map(({ id }) => id))
      .toEqual(expectedCatholicIds);
    expect(Object.keys(themeVarsRes.body.themes)).toEqual(
      themesRes.body.themes.map(({ id }) => id)
    );
  });

  test("a client that has not unlocked the PIN cannot control the Mass", async () => {
    await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

    const locked = await request(app)
      .post("/api/new-mass")
      .set("x-sacra-control", "not-a-session")
      .send({ title: "Stolen Mass", startTime: "" })
      .expect(401);
    expect(locked.body.error).toMatch(/Unlock required/i);

    await request(app)
      .post("/api/screen-settings")
      .set("x-sacra-control", "not-a-session")
      .send({})
      .expect(401);
    await request(app)
      .post("/api/start-pin")
      .set("x-sacra-control", "not-a-session")
      .send({ pin: "" })
      .expect(403);

    const stateBefore = await request(app).get("/api/state").expect(200);
    expect(stateBefore.body.presentation.title).not.toBe("Stolen Mass");

    await request(app)
      .post("/api/new-mass")
      .send({ title: "Operator Mass", startTime: "" })
      .expect(200);

    const phone = "203.0.113.77";
    const unlocked = await request(app)
      .post("/api/verify-pin")
      .set("X-Forwarded-For", phone)
      .send({ pin: "1234" })
      .expect(200);
    await request(app)
      .post("/api/screen-settings")
      .set("X-Forwarded-For", phone)
      .set("x-sacra-control", unlocked.body.controlToken)
      .send({})
      .expect(200);
  });

  test("verify-pin rejects incorrect values and accepts correct ones", async () => {
    await request(app).post("/api/start-pin").send({ pin: "4567" }).expect(200);

    const bad = await request(app).post("/api/verify-pin").send({ pin: "0000" }).expect(403);
    expect(bad.body.error).toMatch(/Incorrect PIN/i);

    const good = await request(app).post("/api/verify-pin").send({ pin: "4567" }).expect(200);
    expect(good.body.ok).toBe(true);
    expect(good.body.redirect).toMatch(/^\/api\/start-redirect\?token=/);
  });

  test("start-redirect token is bound to user-agent", async () => {
    await request(app).post("/api/start-pin").send({ pin: "2468" }).expect(200);

    const verify = await request(app)
      .post("/api/verify-pin")
      .set("User-Agent", "MassTestUA-A")
      .send({ pin: "2468" })
      .expect(200);

    const token = extractTokenFromRedirect(verify.body.redirect);
    expect(token).toBeTruthy();

    await request(app)
      .get(`/api/start-redirect?token=${token}`)
      .set("User-Agent", "MassTestUA-B")
      .expect(302)
      .expect("Location", "/start");
  });

  test("start-redirect token expires after one hour", async () => {
    await request(app).post("/api/start-pin").send({ pin: "2468" }).expect(200);

    const realNow = Date.now;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => realNow());
    const verify = await request(app)
      .post("/api/verify-pin")
      .set("User-Agent", "MassTestUA-C")
      .send({ pin: "2468" })
      .expect(200);

    const token = extractTokenFromRedirect(verify.body.redirect);
    expect(token).toBeTruthy();

    nowSpy.mockImplementation(() => realNow() + (60 * 60 * 1000) + 1000);

    await request(app)
      .get(`/api/start-redirect?token=${token}`)
      .set("User-Agent", "MassTestUA-C")
      .expect(302)
      .expect("Location", "/start");

    nowSpy.mockRestore();
  });

  test("a phone joining after Mass has begun does not rewind the projector", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "text:opening", type: "text", label: "Opening", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
          { id: "text:homily", type: "text", label: "Homily", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "text:opening": { text: "Opening hymn" },
          "text:homily": { text: "Homily" }
        }
      })
      .expect(200);

    await request(app)
      .post("/api/start-time")
      .send({ time: new Date(Date.now() - (60 * 60 * 1000)).toISOString() })
      .expect(200);

    state.currentSlideIndex = 1;
    state.preMassRunning = false;
    state.gatheringRunning = false;
    state.postMassRunning = false;

    const before = await request(app).get("/api/state").expect(200);
    expect(before.body.currentSlideIndex).toBe(1);

    await request(app)
      .get("/api/start-redirect")
      .expect(302)
      .expect("Location", "/remote");

    const after = await request(app).get("/api/state").expect(200);
    expect(after.body.currentSlideIndex).toBe(1);
    expect(after.body.preMassRunning).toBe(false);
    expect(after.body.gatheringRunning).toBe(false);
    expect(after.body.postMassRunning).toBe(false);
  });

  test("preview-manual-slide returns split slides for text hard breaks", async () => {
    const res = await request(app)
      .post("/api/preview-manual-slide")
      .send({
        type: "text",
        label: "Announcements",
        phase: "mass",
        backgroundTheme: "dark",
        manualSlide: {
          text: "First block\n---\nSecond block",
          notes: "",
          textVAlign: "middle"
        }
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.slides).toHaveLength(2);
    expect(res.body.slides[0].text).toBe("First block");
    expect(res.body.slides[1].text).toBe("Second block");
  });

  test("preview-reading includes the organizer label as groupLabel", async () => {
    const readingsDir = path.join(handle.homeDir, "preview-reading");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(readingsDir, "Reading_I.txt"),
      "Acts of the Apostles 2:42-47\n\nThey devoted themselves to the teaching of the apostles.",
      "utf8"
    );

    await request(app)
      .post("/api/load-readings")
      .send({ folderPath: readingsDir })
      .expect(200);

    const res = await request(app)
      .post("/api/preview-reading")
      .send({
        stem: "Reading_I",
        label: "First Reading",
        text: "They devoted themselves to the teaching of the apostles."
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.slides[0].groupLabel).toBe("First Reading");
  });

  test("save-reading rejects a stem that escapes the current Mass", async () => {
    const readingsDir = path.join(handle.homeDir, "save-reading-guard");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(readingsDir, "Reading_I.txt"),
      "Genesis 1:1\n\nIn the beginning.",
      "utf8"
    );
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);

    const outsideFile = path.join(handle.homeDir, ".sacra-lux", "outside.txt");
    const absoluteFile = path.join(handle.homeDir, "absolute-target.txt");
    fs.writeFileSync(outsideFile, "keep-outside", "utf8");
    fs.writeFileSync(absoluteFile, "keep-absolute", "utf8");

    await request(app)
      .post("/api/save-reading")
      .send({ stem: "../outside", text: "pwned" })
      .expect(400);
    await request(app)
      .post("/api/save-reading")
      .send({ stem: absoluteFile.slice(0, -4), text: "pwned" })
      .expect(400);

    expect(fs.readFileSync(outsideFile, "utf8")).toBe("keep-outside");
    expect(fs.readFileSync(absoluteFile, "utf8")).toBe("keep-absolute");

    await request(app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "Updated text." })
      .expect(200);
    const saved = fs.readFileSync(
      path.join(handle.homeDir, ".sacra-lux", "current_mass", "Reading_I.txt"),
      "utf8"
    );
    expect(saved).toContain("Updated text.");
    expect(saved.startsWith("Genesis 1:1")).toBe(true);
  });

  function snapshotTree(rootDir) {
    const files = {};
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          files[path.relative(rootDir, fullPath)] = fs.readFileSync(fullPath);
        }
      }
    };
    walk(rootDir);
    return files;
  }

  test("a failed Mass replacement leaves the current Mass byte-for-byte", async () => {
    const readingsDir = path.join(handle.homeDir, "keep-current-readings");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.");
    fs.writeFileSync(path.join(readingsDir, "mass_title.txt"), "Keep Me\n");
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));

    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    fs.writeFileSync(path.join(currentMassDir, "canary.txt"), "keep-me");
    const before = snapshotTree(currentMassDir);
    const titleBefore = (await request(app).get("/api/state").expect(200)).body.presentation.title;

    await request(app)
      .post("/api/load-readings")
      .send({ folderPath: path.join(handle.homeDir, "missing-readings-folder") })
      .expect(400);

    const brokenArchive = path.join(handle.homeDir, ".sacra-lux", "mass_history", "Broken-Package", "package");
    fs.mkdirSync(brokenArchive, { recursive: true });
    fs.writeFileSync(path.join(brokenArchive, "note.txt"), "no mass json");
    await request(app).post("/api/mass-history/Broken-Package/load").expect(400);

    const emptyArchive = path.join(handle.homeDir, ".sacra-lux", "mass_history", "Empty-Archive");
    fs.mkdirSync(emptyArchive, { recursive: true });
    await request(app).post("/api/mass-history/Empty-Archive/load").expect(400);

    const badZip = new AdmZip();
    badZip.addFile("mass.json", Buffer.from("{"));
    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: badZip.toBuffer().toString("base64") })
      .expect(500);

    const nullZip = new AdmZip();
    nullZip.addFile("mass.json", Buffer.from("null"));
    const nullImport = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: nullZip.toBuffer().toString("base64") });
    expect(nullImport.status).toBeGreaterThanOrEqual(400);

    expect(snapshotTree(currentMassDir)).toEqual(before);
    const titleAfter = (await request(app).get("/api/state").expect(200)).body.presentation.title;
    expect(titleAfter).toBe(titleBefore);

    const replacementDir = path.join(handle.homeDir, "replacement-readings");
    fs.mkdirSync(replacementDir, { recursive: true });
    fs.writeFileSync(path.join(replacementDir, "Gospel.txt"), "John 1:1\n\nIn the beginning was the Word.");
    fs.writeFileSync(path.join(replacementDir, "mass_title.txt"), "Replacement\n");
    await request(app).post("/api/load-readings").send({ folderPath: replacementDir }).expect(200);
    expect(fs.existsSync(path.join(currentMassDir, "canary.txt"))).toBe(false);
    expect(fs.existsSync(path.join(currentMassDir, "Gospel.txt"))).toBe(true);
    expect((await request(app).get("/api/state").expect(200)).body.presentation.title).toBe("Replacement");
  });

  test("startup prefers valid current_mass over stale session title", async () => {
    const homeDir = createTempHome("sacra-lux-startup-valid-");
    const appDir = path.join(homeDir, ".sacra-lux");
    const currentMassDir = path.join(appDir, "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "session.json"), JSON.stringify({
      savedAt: new Date().toISOString(),
      presentationTitle: "Inline Reading Mass",
      lastReadingsFolderPath: "/tmp/not-the-real-mass"
    }), "utf8");
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({
      format: "sacra-lux.mass",
      version: 3,
      metadata: {
        title: "Fourth Sunday of Easter 9:30 AM"
      },
      presentationDefaults: {},
      items: []
    }), "utf8");

    jest.resetModules();
    const isolatedHandle = await startIsolatedServer({ port: 0, homeDir });
    try {
      const stateRes = await request(isolatedHandle.app).get("/api/state").expect(200);
      expect(stateRes.body.presentation.title).toBe("Fourth Sunday of Easter 9:30 AM");
      expect(stateRes.body.startupPrompt).toBeNull();
    } finally {
      await isolatedHandle.stop();
    }
  });

  test("startup with missing current_mass prompts the Mass library", async () => {
    const homeDir = createTempHome("sacra-lux-startup-missing-");
    const appDir = path.join(homeDir, ".sacra-lux");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "session.json"), JSON.stringify({
      savedAt: new Date().toISOString(),
      presentationTitle: "Inline Reading Mass",
      lastReadingsFolderPath: "/tmp/not-the-real-mass"
    }), "utf8");

    jest.resetModules();
    const isolatedHandle = await startIsolatedServer({ port: 0, homeDir });
    try {
      const stateRes = await request(isolatedHandle.app).get("/api/state").expect(200);
      expect(stateRes.body.presentation.title).toBe("No presentation loaded");
      expect(stateRes.body.organizerSequence).toEqual([]);
      expect(stateRes.body.presentation.slides).toEqual([]);
      expect(stateRes.body.startupPrompt).toEqual({
        type: "mass-library",
        reason: "missing-current-mass"
      });
    } finally {
      await isolatedHandle.stop();
    }
  });

  test("startup with invalid current_mass prompts the Mass library", async () => {
    const homeDir = createTempHome("sacra-lux-startup-invalid-");
    const appDir = path.join(homeDir, ".sacra-lux");
    const currentMassDir = path.join(appDir, "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, "session.json"), JSON.stringify({
      savedAt: new Date().toISOString(),
      presentationTitle: "Inline Reading Mass",
      lastReadingsFolderPath: "/tmp/not-the-real-mass"
    }), "utf8");
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "{not json", "utf8");

    jest.resetModules();
    const isolatedHandle = await startIsolatedServer({ port: 0, homeDir });
    try {
      const stateRes = await request(isolatedHandle.app).get("/api/state").expect(200);
      expect(stateRes.body.presentation.title).toBe("No presentation loaded");
      expect(stateRes.body.startupPrompt).toEqual({
        type: "mass-library",
        reason: "invalid-current-mass"
      });
    } finally {
      await isolatedHandle.stop();
    }
  });

  test("preview-manual-slide preserves style overrides for hymn slides", async () => {
    const res = await request(app)
      .post("/api/preview-manual-slide")
      .send({
        type: "hymn",
        label: "Opening Hymn",
        phase: "mass",
        backgroundTheme: "dark",
        manualSlide: {
          text: "Holy God",
          notes: "",
          textVAlign: "middle",
          styleOverrides: {
            fontFamily: "Lora",
            fontSizePx: 96,
            bold: true,
            italic: false,
            outline: true,
            shadow: false
          }
        }
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.slides[0].type).toBe("hymn");
    expect(res.body.slides[0].styleOverrides).toEqual({
      fontFamily: "Lora",
      fontSizePx: 96,
      bold: true,
      italic: false,
      outline: true,
      shadow: false
    });
  });

  test("organizer endpoint validates sequence payload", async () => {
    const res = await request(app)
      .post("/api/organizer")
      .send({ sequence: "not-an-array" })
      .expect(400);

    expect(res.body.error).toMatch(/sequence array is required/i);
  });

  test("screen settings update persists normalized values", async () => {
    await request(app)
      .post("/api/screen-settings")
      .send({
        fontFamily: "NotARealFont",
        readingTextAlign: "center",
        readingTextHeightPx: 860,
        readingTextColor: "#ffffff",
        readingTextOutlineWidthPx: 99,
        readingPassageOutline: true,
        readingPassageOutlineColor: "#111111",
        readingPassageOutlineWidthPx: 25,
        readingSectionOutline: true,
        readingSectionOutlineColor: "#222222",
        readingSectionOutlineWidthPx: 24,
        textSlideTextOutlineWidthPx: 22
      })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.screenSettings.fontFamily).toBe("Merriweather");
    expect(stateRes.body.screenSettings.readingTextAlign).toBe("center");
    expect(stateRes.body.screenSettings.readingTextHeightPx).toBe(860);
    expect(stateRes.body.screenSettings.readingTextColor).toBe("#ffffff");
    expect(stateRes.body.screenSettings.readingTextOutlineWidthPx).toBe(20);
    expect(stateRes.body.screenSettings.readingPassageOutline).toBe(true);
    expect(stateRes.body.screenSettings.readingPassageOutlineColor).toBe("#111111");
    expect(stateRes.body.screenSettings.readingPassageOutlineWidthPx).toBe(20);
    expect(stateRes.body.screenSettings.readingSectionOutline).toBe(true);
    expect(stateRes.body.screenSettings.readingSectionOutlineColor).toBe("#222222");
    expect(stateRes.body.screenSettings.readingSectionOutlineWidthPx).toBe(20);
    expect(stateRes.body.screenSettings.textSlideTextOutlineWidthPx).toBe(20);
  });

  test("mass asset upload sanitizes the stored filename", async () => {
    const res = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "../../unsafe<script>.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    const storedName = String(res.body.url || "").split("/").pop();
    expect(storedName).toBeTruthy();
    expect(storedName).not.toMatch(/[\\/<>:"|?*]/);
    expect(storedName).toMatch(/\.png$/);

    const assetPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets", storedName);
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  test("mass asset route rejects invalid filenames", async () => {
    const res = await request(app)
      .get("/api/mass-asset/bad:name.png")
      .expect(400);

    expect(String(res.body.error || "")).toMatch(/invalid filename/i);
  });

  test("image slideshow organizer state preserves order, timing, and loops", async () => {
    const betaUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Beta.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const alphaUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Alpha.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{
          id: "slideshow:test",
          type: "imageSlideshow",
          label: "Announcements",
          phase: "mass",
          backgroundTheme: "light",
          durationSec: 4
        }],
        manualSlides: {
          "slideshow:test": {
            images: [
              { url: betaUpload.body.url, name: "Beta.png" },
              { url: alphaUpload.body.url, name: "Alpha.png" }
            ],
            slideshowDurationSec: 4,
            slideshowLoopCount: 3
          }
        }
      })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.manualSlides["slideshow:test"]).toMatchObject({
      images: [
        { url: betaUpload.body.url, name: "Beta.png" },
        { url: alphaUpload.body.url, name: "Alpha.png" }
      ],
      slideshowDurationSec: 4,
      slideshowLoopCount: 3
    });
    expect(stateRes.body.presentation.slides).toHaveLength(2);
    expect(stateRes.body.presentation.slides.map((slide) => slide.slideshowImageName)).toEqual(["Beta.png", "Alpha.png"]);
    expect(stateRes.body.imageSlideshowEndsAt).toEqual(expect.any(Number));
  });

  test("image slideshow preflight reports duplicates, missing, unsupported, and unreadable files", async () => {
    const uploaded = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Valid.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "broken.png"), "not an image", "utf8");

    const preflight = await request(app)
      .post("/api/image-slideshow/preflight")
      .send({
        images: [
          { url: uploaded.body.url, name: "Valid.png" },
          { url: uploaded.body.url, name: "Valid copy.png" },
          { url: "/api/mass-asset/missing.png", name: "Missing.png" },
          { url: "/api/mass-asset/unsupported.bmp", name: "Unsupported.bmp" },
          { url: "/api/mass-asset/broken.png", name: "Broken.png" }
        ]
      })
      .expect(200);

    expect(preflight.body.validCount).toBe(2);
    expect(preflight.body.results[0].warnings).toContain("duplicate");
    expect(preflight.body.results[1].warnings).toContain("duplicate");
    expect(preflight.body.results[2].warnings).toContain("missing");
    expect(preflight.body.results[3].warnings).toContain("unsupported");
    expect(preflight.body.results[4].warnings).toContain("unreadable");
  });

  test("image slideshow includes fade time and loops exactly before advancing", async () => {
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Slideshow Timer", startTime: "" })
      .expect(200);
    const uploaded = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Only.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "slideshow:timer", type: "imageSlideshow", label: "Loop twice", phase: "mass", backgroundTheme: "light", durationSec: 1 },
          { id: "text:after", type: "text", label: "After", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "slideshow:timer": {
            images: [{ url: uploaded.body.url, name: "Only.png" }],
            slideshowDurationSec: 1,
            slideshowLoopCount: 2
          },
          "text:after": { text: "Finished" }
        }
      })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    let stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(0);
    expect(stateRes.body.imageSlideshowLoopIteration).toBe(2);
    expect(stateRes.body.imageSlideshowEndsAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 500));
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(1);
    expect(stateRes.body.imageSlideshowEndsAt).toBeNull();
  });

  test("empty image slideshows safely advance instead of becoming stuck", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "empty-slideshow", type: "imageSlideshow", label: "Empty", phase: "mass", backgroundTheme: "light" },
          { id: "after-empty", type: "text", label: "Next", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          "empty-slideshow": { images: [], slideshowDurationSec: 1, slideshowLoopCount: 1 },
          "after-empty": { text: "The next slide", textVAlign: "middle" }
        }
      })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 250));
    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.slides[stateRes.body.currentSlideIndex].organizerItemId).toBe("after-empty");
    expect(stateRes.body.imageSlideshowEndsAt).toBeNull();
  });

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const currentItemId = (body) => body.presentation.slides[body.currentSlideIndex]?.organizerItemId;

  test("gathering skips an empty image slideshow without jumping ahead to Mass", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "g-welcome", type: "text", label: "Welcome", phase: "gathering", backgroundTheme: "dark", durationSec: 1 },
          { id: "g-empty", type: "imageSlideshow", label: "Empty", phase: "gathering", backgroundTheme: "light" },
          { id: "g-hymn", type: "text", label: "Hymn", phase: "gathering", backgroundTheme: "dark", durationSec: 10 },
          { id: "m-first", type: "text", label: "Mass", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          "g-welcome": { text: "Welcome" },
          "g-empty": { images: [], slideshowDurationSec: 1, slideshowLoopCount: 1 },
          "g-hymn": { text: "Hymn" },
          "m-first": { text: "Mass" }
        }
      })
      .expect(200);

    await request(app).post("/api/gathering/start").expect(200);
    await wait(1400);
    const stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("g-hymn");
    expect(stateRes.body.gatheringRunning).toBe(true);
    await request(app).post("/api/gathering/stop").expect(200);
  });

  test("pre-mass loop skips an empty image slideshow without restarting the loop", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "p-a", type: "text", label: "A", phase: "pre", backgroundTheme: "dark", durationSec: 1 },
          { id: "p-empty", type: "imageSlideshow", label: "Empty", phase: "pre", backgroundTheme: "light" },
          { id: "p-b", type: "text", label: "B", phase: "pre", backgroundTheme: "dark", durationSec: 10 },
          { id: "p-c", type: "text", label: "C", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "p-a": { text: "A" },
          "p-empty": { images: [], slideshowDurationSec: 1, slideshowLoopCount: 1 },
          "p-b": { text: "B" },
          "p-c": { text: "C" }
        }
      })
      .expect(200);

    await request(app).post("/api/pre-mass/start").expect(200);
    await wait(1400);
    const stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("p-b");
    await request(app).post("/api/pre-mass/stop");
  });

  test("removing the playing slideshow during a pre-mass loop keeps the loop advancing", async () => {
    const uploaded = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Loop.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const textItems = [
      { id: "r-a", type: "text", label: "A", phase: "pre", backgroundTheme: "dark", durationSec: 1 },
      { id: "r-b", type: "text", label: "B", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
    ];
    const textSlides = { "r-a": { text: "A" }, "r-b": { text: "B" } };

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "r-show", type: "imageSlideshow", label: "Show", phase: "pre", backgroundTheme: "light" },
          ...textItems
        ],
        manualSlides: {
          "r-show": { images: [{ url: uploaded.body.url, name: "Loop.png" }], slideshowDurationSec: 100, slideshowLoopCount: 1 },
          ...textSlides
        }
      })
      .expect(200);
    await request(app).post("/api/pre-mass/start").expect(200);

    await request(app).post("/api/organizer").send({ sequence: textItems, manualSlides: textSlides }).expect(200);
    let stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("r-a");
    expect(stateRes.body.preMassRunning).toBe(true);

    await wait(1300);
    stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("r-b");
    await request(app).post("/api/pre-mass/stop");
  });

  test("organizer saves keep a playing slideshow's loop progress", async () => {
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Slideshow Progress", startTime: "" })
      .expect(200);
    const uploaded = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Progress.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const sequence = [
      { id: "l-show", type: "imageSlideshow", label: "Loop three", phase: "mass", backgroundTheme: "light" },
      { id: "l-after", type: "text", label: "After", phase: "mass", backgroundTheme: "dark" }
    ];
    const manualSlides = (afterText) => ({
      "l-show": { images: [{ url: uploaded.body.url, name: "Progress.png" }], slideshowDurationSec: 1, slideshowLoopCount: 3 },
      "l-after": { text: afterText }
    });

    await request(app).post("/api/organizer").send({ sequence, manualSlides: manualSlides("Before edit") }).expect(200);
    await wait(1100);
    let stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.imageSlideshowLoopIteration).toBe(2);

    await request(app).post("/api/organizer").send({ sequence, manualSlides: manualSlides("After edit") }).expect(200);
    stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("l-show");
    expect(stateRes.body.imageSlideshowLoopIteration).toBe(2);
  });

  test("mass history tracks active and archived Masses", async () => {
    await request(app)
      .post("/api/new-mass")
      .send({ title: "History One", startTime: "2026-04-01T09:00" })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 700));

    let historyRes = await request(app).get("/api/mass-history").expect(200);
    expect(historyRes.body.activeArchiveId).toBe("History-One");
    expect(historyRes.body.archives.map((entry) => entry.id)).toContain("History-One");

    await request(app)
      .post("/api/new-mass")
      .send({ title: "History Two", startTime: "2026-04-08T09:00" })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 700));

    historyRes = await request(app).get("/api/mass-history").expect(200);
    expect(historyRes.body.activeArchiveId).toBe("History-Two");
    expect(historyRes.body.archives.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["History-One", "History-Two"])
    );

    await request(app)
      .post("/api/mass-history/History-One/compress")
      .expect(200);

    historyRes = await request(app).get("/api/mass-history").expect(200);
    const firstArchive = historyRes.body.archives.find((entry) => entry.id === "History-One");
    expect(firstArchive.storage).toBe("compressed");
  });

  test("duplicate-mass archives the current Mass and resets playback state", async () => {
    // A start still ahead of its gathering lead-in stays on slide 0.
    // A start already inside the gathering window is covered by the wall-clock tests.
    const futureStart = (daysAhead) => {
      const when = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
    };
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Original Mass", startTime: futureStart(2) })
      .expect(200);

    await request(app)
      .post("/api/pre-mass/start")
      .expect(200);

    const duplicate = await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "Copied Mass", startTime: futureStart(7) })
      .expect(200);

    expect(duplicate.body.archivedMassId).toBe("Original-Mass");
    expect(duplicate.body.title).toBe("Copied Mass");

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.title).toBe("Copied Mass");
    expect(stateRes.body.currentSlideIndex).toBe(0);
    expect(stateRes.body.preMassRunning).toBe(false);
    expect(stateRes.body.isBlack).toBe(false);

    const historyRes = await request(app).get("/api/mass-history").expect(200);
    expect(historyRes.body.archives.map((entry) => entry.id)).toContain("Original-Mass");
  });

  test("a countdown does not advance a newly created Mass", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "c-timer", type: "countdown", label: "Timer", phase: "pre", backgroundTheme: "dark" },
          { id: "c-after", type: "text", label: "After", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "c-timer": { text: "", countdownSec: 1 },
          "c-after": { text: "After" }
        }
      })
      .expect(200);
    await request(app).post("/api/pre-mass/start").expect(200);

    let stateRes = await request(app).get("/api/state").expect(200);
    expect(currentItemId(stateRes.body)).toBe("c-timer");

    await request(app)
      .post("/api/new-mass")
      .send({ title: "Fresh Mass", startTime: "" })
      .expect(200);

    // The old 1-second countdown would fire about now; the new Mass must not move.
    await wait(1300);
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(0);
    expect(stateRes.body.countdownEndsAt).toBeNull();
  });

  test("a post-Mass loop does not survive loading another Mass", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "post-a", type: "text", label: "Post A", phase: "post", backgroundTheme: "dark", durationSec: 1 },
          { id: "post-b", type: "text", label: "Post B", phase: "post", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: { "post-a": { text: "Post A" }, "post-b": { text: "Post B" } }
      })
      .expect(200);
    await request(app).post("/api/post-mass/start").expect(200);

    await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "After Post Mass", startTime: "" })
      .expect(200);

    let stateRes = await request(app).get("/api/state").expect(200);
    const parkedIndex = stateRes.body.currentSlideIndex;
    expect(stateRes.body.postMassRunning).toBe(false);

    // The old 1-second post-Mass timer must not advance the duplicated Mass.
    await wait(1300);
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(parkedIndex);
    expect(stateRes.body.postMassRunning).toBe(false);
  });

  test("escaped archive ids are rejected and leave the data directory in place", async () => {
    const sacraDir = path.join(handle.homeDir, ".sacra-lux");
    const canary = path.join(sacraDir, "canary.txt");
    fs.mkdirSync(sacraDir, { recursive: true });
    fs.writeFileSync(canary, "keep", "utf8");

    const serverUrl = new URL(handle.baseUrl);
    const rawRequest = (method, requestPath) => new Promise((resolve, reject) => {
      const req = http.request({
        hostname: serverUrl.hostname,
        port: serverUrl.port,
        method,
        path: requestPath
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });

    for (const encodedId of ["%2e%2e%2f%2e%2e", "..%2f..", "%2e%2e", "%2e"]) {
      expect(await rawRequest("DELETE", `/api/mass-history/${encodedId}`)).toBe(400);
      expect(await rawRequest("POST", `/api/mass-history/${encodedId}/load`)).toBe(400);
      expect(await rawRequest("POST", `/api/mass-history/${encodedId}/compress`)).toBe(400);
    }

    expect(fs.existsSync(sacraDir)).toBe(true);
    expect(fs.readFileSync(canary, "utf8")).toBe("keep");
  });

  test("import-mass-zip ignores nested and traversal entry paths", async () => {
    const zip = new AdmZip();
    zip.addFile("settings.json", Buffer.from(JSON.stringify({
      version: 2,
      presentationTitle: "Imported Mass",
      screenSettings: {},
      organizerSequence: [],
      manualSlides: {}
    })));
    zip.addFile("readings/Reading_I.txt", Buffer.from("Genesis 1:1-3\n\nIn the beginning."));
    zip.addFile("readings/../../evil.txt", Buffer.from("blocked"));
    zip.addFile("readings/assets/safe.png", Buffer.from("safe-image"));
    zip.addFile("readings/assets/../../unsafe.png", Buffer.from("blocked-image"));
    zip.addFile("uploads/uploaded.png", Buffer.from("uploaded-image"));
    zip.addFile("uploads/../../skip.png", Buffer.from("blocked-upload"));

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    expect(fs.existsSync(path.join(currentMassDir, "Reading_I.txt"))).toBe(true);
    expect(fs.existsSync(path.join(currentMassDir, "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "safe.png"))).toBe(true);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "uploaded.png"))).toBe(true);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "unsafe.png"))).toBe(false);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "skip.png"))).toBe(false);
  });

  test("export-mass-zip writes a v3 mass.json document without PIN data", async () => {
    await request(app)
      .post("/api/start-pin")
      .send({ pin: "2468" })
      .expect(200);

    await request(app)
      .post("/api/new-mass")
      .send({ title: "Document Export", startTime: "2026-04-20T09:00" })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          {
            id: "reading-1",
            type: "reading",
            label: "First Reading",
            phase: "mass",
            backgroundTheme: "dark"
          },
          {
            id: "text-1",
            type: "text",
            label: "Welcome",
            phase: "pre",
            backgroundTheme: "dark"
          }
        ],
        manualSlides: {
          "text-1": {
            text: "Welcome everyone",
            notes: "",
            textVAlign: "middle",
            imageUrl: null
          }
        }
      })
      .expect(200);

    const zipRes = await request(app)
      .get("/api/export-mass-zip")
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const zip = new AdmZip(zipRes.body);
    const massEntry = zip.getEntry("mass.json");
    expect(massEntry).toBeTruthy();

    const massDocument = JSON.parse(massEntry.getData().toString("utf8"));
    expect(massDocument.format).toBe("sacra-lux.mass");
    expect(massDocument.version).toBe(3);
    expect(massDocument.metadata.title).toBe("Document Export");
    expect(massDocument.metadata.scheduledStart).toBe("2026-04-20T09:00");
    expect(massDocument.startPinHash).toBeUndefined();
    expect(massDocument.items.map((item) => item.id)).toEqual(["reading-1", "text-1"]);
  });

  test("image slideshow assets and settings round-trip through a Mass ZIP", async () => {
    const alphaUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Alpha.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const betaUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Beta.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{
          id: "slideshow-zip",
          type: "imageSlideshow",
          label: "Parish Photos",
          phase: "mass",
          backgroundTheme: "light"
        }],
        manualSlides: {
          "slideshow-zip": {
            images: [
              { url: betaUpload.body.url, name: "Beta.png" },
              { url: alphaUpload.body.url, name: "Alpha.png" }
            ],
            slideshowDurationSec: 7,
            slideshowLoopCount: 3
          }
        }
      })
      .expect(200);

    const zipRes = await request(app)
      .get("/api/export-mass-zip")
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const exportedZip = new AdmZip(zipRes.body);
    const massDocument = JSON.parse(exportedZip.getEntry("mass.json").getData().toString("utf8"));
    const slideshowItem = massDocument.items.find((item) => item.id === "slideshow-zip");
    expect(slideshowItem.kind).toBe("imageSlideshow");
    expect(slideshowItem.content).toEqual({ secondsPerImage: 7, loopCount: 3 });
    expect(slideshowItem.assets.map((asset) => asset.name)).toEqual(["Beta.png", "Alpha.png"]);
    slideshowItem.assets.forEach((asset) => {
      expect(exportedZip.getEntry(asset.ref)).toBeTruthy();
    });

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: exportedZip.toBuffer().toString("base64") })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.manualSlides["slideshow-zip"]).toMatchObject({
      slideshowDurationSec: 7,
      slideshowLoopCount: 3
    });
    expect(stateRes.body.manualSlides["slideshow-zip"].images.map((image) => image.name))
      .toEqual(["Beta.png", "Alpha.png"]);
  });

  test("import-mass-zip accepts v3 mass documents with inline readings", async () => {
    const zip = new AdmZip();
    zip.addFile("mass.json", Buffer.from(JSON.stringify({
      format: "sacra-lux.mass",
      version: 3,
      metadata: {
        title: "Inline Reading Mass",
        scheduledStart: "2026-04-27T09:00:00-04:00"
      },
      presentationDefaults: {
        fontFamily: "Merriweather"
      },
      items: [
        {
          id: "reading-1",
          kind: "reading",
          label: "First Reading",
          section: "mass",
          content: {
            text: "In the beginning..."
          },
          source: {
            stem: "Reading_I",
            citation: "Genesis 1:1-3"
          }
        },
        {
          id: "hymn-1",
          kind: "hymn",
          label: "Opening Hymn",
          section: "mass",
          content: {
            text: "Holy God"
          },
          presentation: {
            background: "dark",
            textVAlign: "middle"
          }
        }
      ]
    })));

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.title).toBe("Inline Reading Mass");
    expect(stateRes.body.massStartTime).toBe("2026-04-27T09:00:00-04:00");
    expect(stateRes.body.organizerSequence.map((item) => item.id)).toEqual(["reading-1", "hymn-1"]);
    expect(stateRes.body.presentation.slides.some((slide) => slide.organizerItemId === "reading-1")).toBe(true);

    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    expect(fs.existsSync(path.join(currentMassDir, "Reading_I.txt"))).toBe(true);
  });

  test("organizer endpoint rejects duplicate organizer ids", async () => {
    const res = await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "dup", type: "text", label: "One", phase: "mass", backgroundTheme: "dark" },
          { id: "dup", type: "text", label: "Two", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {}
      })
      .expect(400);

    expect(String(res.body.error || "")).toMatch(/duplicate organizer item id/i);
  });

  test("verify-pin applies escalating lockout with retry-after header", async () => {
    const lockedIp = "203.0.113.42";

    await request(app).post("/api/start-pin").send({ pin: "1357" }).expect(200);

    let locked;
    for (let i = 0; i < 6; i += 1) {
      // Keep sending the wrong PIN until the server applies lockout.
      const attempt = await request(app)
        .post("/api/verify-pin")
        .set("X-Forwarded-For", lockedIp)
        .send({ pin: "0000" });
      if (attempt.status === 429) {
        locked = attempt;
        break;
      }
      expect([403, 429]).toContain(attempt.status);
    }

    expect(locked).toBeDefined();
    expect(locked.headers["retry-after"]).toBeDefined();
    expect(Number(locked.headers["retry-after"]) > 0).toBe(true);
    expect(String(locked.body.error || "")).toMatch(/too many/i);
  });

  test("global api limiter throttles after 120 requests per minute per IP", async () => {
    const ip = "198.51.100.10";

    for (let i = 0; i < 120; i += 1) {
      await request(app)
        .get("/api/state")
        .set("X-Forwarded-For", ip)
        .expect(200);
    }

    const limited = await request(app)
      .get("/api/state")
      .set("X-Forwarded-For", ip)
      .expect(429);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[rate-limit] global-api throttled"));
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(String(limited.body.error || "")).toMatch(/too many requests/i);
  });

  test("auth limiter throttles start-pin after 10 requests in 5 minutes per IP", async () => {
    const ip = "198.51.100.11";

    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .post("/api/start-pin")
        .set("X-Forwarded-For", ip)
        .send(i === 0 ? { pin: "2468" } : { pin: "2468", currentPin: "2468" })
        .expect(200);
    }

    const limited = await request(app)
      .post("/api/start-pin")
      .set("X-Forwarded-For", ip)
      .send({ pin: "2468" })
      .expect(429);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[rate-limit] auth-api throttled"));
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(String(limited.body.error || "")).toMatch(/too many requests/i);
  });

  test("upload limiter throttles image uploads after 20 requests in 10 minutes per IP", async () => {
    const ip = "198.51.100.12";

    for (let i = 0; i < 20; i += 1) {
      await request(app)
        .post("/api/upload-mass-asset")
        .set("X-Forwarded-For", ip)
        .send({ filename: `test-${i}.png`, dataUrl: tinyPngDataUrl })
        .expect(200);
    }

    const limited = await request(app)
      .post("/api/upload-mass-asset")
      .set("X-Forwarded-For", ip)
      .send({ filename: "overflow.png", dataUrl: tinyPngDataUrl })
      .expect(429);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[rate-limit] upload-api throttled"));
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(String(limited.body.error || "")).toMatch(/too many requests/i);
  });

  test("heavy limiter throttles export-mass-zip after 10 requests in 10 minutes per IP", async () => {
    const ip = "198.51.100.13";

    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .get("/api/export-mass-zip")
        .set("X-Forwarded-For", ip)
        .expect(200);
    }

    const limited = await request(app)
      .get("/api/export-mass-zip")
      .set("X-Forwarded-For", ip)
      .expect(429);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[rate-limit] heavy-api throttled"));
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(String(limited.body.error || "")).toMatch(/too many requests/i);
  });
});
