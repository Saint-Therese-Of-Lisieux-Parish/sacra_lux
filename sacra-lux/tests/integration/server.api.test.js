const fs = require("fs");
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
  });

  beforeEach(() => {
    resetSecurityState();
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
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Original Mass", startTime: "2026-04-15T09:00" })
      .expect(200);

    await request(app)
      .post("/api/pre-mass/start")
      .expect(200);

    const duplicate = await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "Copied Mass", startTime: "2026-04-22T09:00" })
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
        .send({ pin: "2468" })
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
