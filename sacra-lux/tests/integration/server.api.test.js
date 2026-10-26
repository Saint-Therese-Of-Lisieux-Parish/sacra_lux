const fs = require("fs");
const http = require("http");
const path = require("path");
const AdmZip = require("adm-zip");
const request = require("supertest");
const { io: createSocket } = require("socket.io-client");

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
  let validateMassZipArchive;
  let MASS_ZIP_LIMITS;
  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=";

  function extractTokenFromRedirect(redirectPath) {
    const match = String(redirectPath || "").match(/token=([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  }

  async function createAvifExport(controlToken) {
    const client = createSocket(handle.baseUrl, {
      transports: ["websocket"],
      auth: { token: controlToken }
    });
    try {
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      const exported = new Promise((resolve, reject) => {
        client.once("export:avif:done", resolve);
        client.once("export:avif:error", ({ error }) => reject(new Error(error)));
        client.once("control:required", ({ error }) => reject(new Error(error)));
      });
      client.emit("export:avif:start");
      return await exported;
    } finally {
      client.disconnect();
    }
  }

  beforeAll(async () => {
    jest.resetModules();
    const homeDir = createTempHome("sacra-lux-int-");
    handle = await startIsolatedServer({ port: 0, homeDir });
    app = handle.app;
    app.set("trust proxy", true);
    ({ resetSecurityState } = require("../../src/security"));
    ({ state } = require("../../src/state"));
    ({ validateMassZipArchive, MASS_ZIP_LIMITS } = require("../../src/server"));
  });

  beforeEach(() => {
    resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    state.controlMode = "unset";
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

  describe("first PIN setup from a non-loopback client", () => {
    let lanLayer;

    // Fake a LAN peer: the server reads the socket address, not a header.
    beforeEach(() => {
      app.use((req, res, next) => {
        Object.defineProperty(req.socket, "remoteAddress", { value: "192.168.1.50", configurable: true });
        next();
      });
      const stack = app.router.stack;
      lanLayer = stack.pop();
      stack.unshift(lanLayer);
    });

    afterEach(() => {
      app.router.stack.splice(app.router.stack.indexOf(lanLayer), 1);
    });

    test("is rejected while no PIN exists and the control mode is unset", async () => {
      const response = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(401);

      expect(response.body.controlToken).toBeUndefined();
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(state.startPinHash).toBeNull();
    });

    test("is accepted in trusted-lan mode", async () => {
      state.controlMode = "trusted-lan";
      const response = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

      expect(response.body.controlToken).toEqual(expect.any(String));
      expect(state.startPinHash).not.toBeNull();
    });

    test("still requires currentPin once a PIN exists", async () => {
      state.controlMode = "trusted-lan";
      await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

      await request(app).post("/api/start-pin").send({ pin: "5678", currentPin: "0000" }).expect(403);
    });
  });

  describe("changing the start PIN", () => {
    async function connectSocket(token) {
      const client = createSocket(handle.baseUrl, { transports: ["websocket"], auth: { token } });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      return client;
    }

    test("ends the old control sessions and keeps the session of the client that changed it", async () => {
      const first = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const oldToken = first.body.controlToken;
      const otherSocket = await connectSocket(oldToken);
      try {
        const required = new Promise((resolve) => otherSocket.once("control:required", resolve));

        const changed = await request(app)
          .post("/api/start-pin")
          .send({ pin: "5678", currentPin: "1234" })
          .expect(200);

        await required;
        await request(app)
          .post("/api/organizer")
          .set("x-sacra-control", oldToken)
          .send({ sequence: [] })
          .expect(401);
        const fresh = await request(app)
          .post("/api/organizer")
          .set("x-sacra-control", changed.body.controlToken)
          .send({ sequence: [] });
        expect(fresh.status).not.toBe(401);
      } finally {
        otherSocket.disconnect();
      }
    });
  });

  test("first PIN from loopback sets the PIN and issues a control token", async () => {
    const response = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

    expect(response.body.controlToken).toEqual(expect.any(String));
    expect(state.startPinHash).not.toBeNull();
  });

  test("control mode endpoint persists the mode and shows it in state", async () => {
    await request(app).post("/api/control-mode").send({ mode: "bogus" }).expect(400);
    expect((await request(app).get("/api/state").expect(200)).body.controlMode).toBe("unset");

    await request(app).post("/api/control-mode").send({ mode: "trusted-lan" }).expect(200);
    expect((await request(app).get("/api/state").expect(200)).body.controlMode).toBe("trusted-lan");
  });

  test("app settings reject an unknown theme without changing the current theme", async () => {
    const before = (await request(app).get("/api/state").expect(200)).body.appSettings.theme;

    const response = await request(app)
      .post("/api/app-settings")
      .send({ theme: "unknown-theme" })
      .expect(400);

    expect(response.body.error).toMatch(/unknown theme/i);
    expect((await request(app).get("/api/state").expect(200)).body.appSettings.theme).toBe(before);
  });

  test("built-in backgrounds are listed with image dimensions and served", async () => {
    const response = await request(app).get("/api/builtin-backgrounds").expect(200);

    expect(response.body.assets).toHaveLength(6);
    expect(response.body.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.stringContaining("1920x1080") }),
      expect.objectContaining({ name: expect.stringContaining("3840x2160") })
    ]));

    const imageResponse = await request(app)
      .get(response.body.assets[0].url)
      .expect(200);
    expect(imageResponse.headers["content-type"]).toMatch(/image\/avif/);
  });

  test("built-in background listing limits requests per IP", async () => {
    const ip = "198.51.100.21";

    for (let i = 0; i < 60; i += 1) {
      await request(app)
        .get("/api/builtin-backgrounds")
        .set("X-Forwarded-For", ip)
        .expect(200);
    }

    const limited = await request(app)
      .get("/api/builtin-backgrounds")
      .set("X-Forwarded-For", ip)
      .expect(429);

    expect(limited.headers["retry-after"]).toBeDefined();
    expect(String(limited.body.error || "")).toMatch(/too many background list requests/i);
  });

  test("new Mass can import the latest USCCB RSS readings", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <rss><channel><item><title>Sample Lectionary Mass</title><description>
          &lt;h4&gt;Reading 1 &lt;a href="https://example.test/reading"&gt;Isaiah 1:1&lt;/a&gt;&lt;/h4&gt;
          &lt;div&gt;&lt;p&gt;The vision of Isaiah.&lt;/p&gt;&lt;/div&gt;
          &lt;h4&gt;Alleluia &lt;a href="https://example.test/verse"&gt;Mark 1:15&lt;/a&gt;&lt;/h4&gt;
          &lt;div&gt;&lt;p&gt;R. Alleluia, alleluia.&lt;/p&gt;&lt;/div&gt;
          &lt;h4&gt;Gospel &lt;a href="https://example.test/gospel"&gt;John 1:1&lt;/a&gt;&lt;/h4&gt;
          &lt;div&gt;&lt;p&gt;In the beginning was the Word.&lt;/p&gt;&lt;/div&gt;
        </description></item></channel></rss>`
    });
    try {
      const response = await request(app)
        .post("/api/new-mass")
        .send({ useLectionaryRss: true })
        .expect(200);

      expect(response.body).toMatchObject({
        title: "Sample Lectionary Mass",
        lectionaryReadingsImported: true
      });
      expect(state.readingsSource.documents).toEqual([
        expect.objectContaining({ section: "Reading I", passage: "Isaiah 1:1" }),
        expect.objectContaining({ section: "Verse Before the Gospel", passage: "Mark 1:15" }),
        expect.objectContaining({ section: "Gospel", passage: "John 1:1" })
      ]);
      expect(state.presentation.slides).toEqual(expect.arrayContaining([
        expect.objectContaining({
          organizerItemId: "mass-reading-1",
          type: "reading",
          passage: "Isaiah 1:1"
        }),
        expect.objectContaining({
          organizerItemId: "mass-gospel",
          type: "reading",
          passage: "John 1:1"
        }),
        expect.objectContaining({
          organizerItemId: "mass-gospel-acclamation",
          type: "reading",
          passage: "Mark 1:15"
        })
      ]));
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("new Mass keeps the current Mass when the USCCB RSS feed is unreachable", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed"));
    const snapshot = () => JSON.stringify({
      organizerSequence: state.organizerSequence,
      manualSlides: state.manualSlides,
      readingsSource: state.readingsSource,
      activeMassArchiveId: state.activeMassArchiveId
    });
    const before = snapshot();
    try {
      const response = await request(app)
        .post("/api/new-mass")
        .send({ useLectionaryRss: true })
        .expect(500);

      expect(String(response.body.error || "")).toMatch(/fetch failed/i);
      expect(snapshot()).toBe(before);
    } finally {
      global.fetch = originalFetch;
    }
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
    const pinResponse = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);

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
      .set("x-sacra-control", pinResponse.body.controlToken)
      .send({ title: "Operator Mass", startTime: "" })
      .expect(200);

    await request(app)
      .post("/api/new-mass")
      .set("X-Forwarded-For", "127.0.0.1")
      .send({ title: "Second Local Client", startTime: "" })
      .expect(401);

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

  test("local filesystem paths are hidden from clients without a control session", async () => {
    const readingsDir = path.join(handle.homeDir, "path-disclosure-readings");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.");
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);

    const pinResponse = await request(app).post("/api/start-pin").send({ pin: "1357" }).expect(200);
    const controlToken = pinResponse.body.controlToken;

    const anonymousInfo = await request(app).get("/api/session-info").expect(200);
    expect(anonymousInfo.body).toEqual({ lastReadingsFolderPath: null, sessionFile: null });
    const anonymousExport = await request(app).get("/api/export-settings").expect(200);
    expect(anonymousExport.body.lastReadingsFolderPath).toBeNull();
    expect(JSON.stringify(anonymousExport.body)).not.toContain(handle.homeDir);

    const operatorInfo = await request(app)
      .get("/api/session-info")
      .set("x-sacra-control", controlToken)
      .expect(200);
    expect(Object.keys(operatorInfo.body).sort()).toEqual(["lastReadingsFolderPath", "sessionFile"]);
    expect(operatorInfo.body.sessionFile).toContain(".sacra-lux");
    const operatorExport = await request(app)
      .get("/api/export-settings")
      .set("x-sacra-control", controlToken)
      .expect(200);
    expect(operatorExport.body.lastReadingsFolderPath).toContain("current_mass");
    expect(JSON.stringify(operatorExport.body)).not.toContain("1357");
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

  test("start-redirect rejects an invalid token and consumes a valid token once", async () => {
    await request(app).post("/api/start-pin").send({ pin: "2468" }).expect(200);

    await request(app)
      .get("/api/start-redirect?token=not-a-real-token")
      .expect(302)
      .expect("Location", "/start");

    const verify = await request(app).post("/api/verify-pin").send({ pin: "2468" }).expect(200);
    const token = extractTokenFromRedirect(verify.body.redirect);
    expect(token).toBeTruthy();

    await request(app)
      .get(`/api/start-redirect?token=${token}`)
      .expect(302)
      .expect("Location", "/remote");
    await request(app)
      .get(`/api/start-redirect?token=${token}`)
      .expect(302)
      .expect("Location", "/start");
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

  describe("no-PIN start redirect before Mass", () => {
    let lanLayer;

    async function seedPreMassSlides() {
      await request(app)
        .post("/api/organizer")
        .send({
          sequence: [
            { id: "text:welcome", type: "text", label: "Welcome", phase: "pre", backgroundTheme: "dark", durationSec: 10 },
            { id: "text:opening", type: "text", label: "Opening", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
          ],
          manualSlides: {
            "text:welcome": { text: "Welcome" },
            "text:opening": { text: "Opening" }
          }
        })
        .expect(200);
      await request(app)
        .post("/api/start-time")
        .send({ time: new Date(Date.now() + (60 * 60 * 1000)).toISOString() })
        .expect(200);
      state.currentSlideIndex = 1;
      state.preMassRunning = false;
      state.gatheringRunning = false;
      state.postMassRunning = false;
    }

    function useLanClient() {
      app.use((req, res, next) => {
        Object.defineProperty(req.socket, "remoteAddress", { value: "192.168.1.50", configurable: true });
        next();
      });
      const stack = app.router.stack;
      lanLayer = stack.pop();
      stack.unshift(lanLayer);
    }

    afterEach(() => {
      if (lanLayer) {
        app.router.stack.splice(app.router.stack.indexOf(lanLayer), 1);
        lanLayer = null;
      }
      state.preMassRunning = false;
    });

    test("a non-loopback client cannot start pre-Mass while the control mode is unset", async () => {
      await seedPreMassSlides();
      useLanClient();

      await request(app).get("/api/start-redirect").expect(302).expect("Location", "/remote");

      const after = await request(app).get("/api/state").expect(200);
      expect(after.body.currentSlideIndex).toBe(1);
      expect(after.body.preMassRunning).toBe(false);
    });

    test("a loopback client starts pre-Mass", async () => {
      await seedPreMassSlides();

      await request(app).get("/api/start-redirect").expect(302).expect("Location", "/remote");

      const after = await request(app).get("/api/state").expect(200);
      expect(after.body.currentSlideIndex).toBe(0);
      expect(after.body.preMassRunning).toBe(true);
    });

    test("a non-loopback client starts pre-Mass in trusted-lan mode", async () => {
      await seedPreMassSlides();
      state.controlMode = "trusted-lan";
      useLanClient();

      await request(app).get("/api/start-redirect").expect(302).expect("Location", "/remote");

      const after = await request(app).get("/api/state").expect(200);
      expect(after.body.currentSlideIndex).toBe(0);
      expect(after.body.preMassRunning).toBe(true);
    });
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

  test("preview-reading repaginates with draft override settings", async () => {
    const body = {
      label: "Sample Reading",
      passage: "Revelation 3:9",
      text: Array.from({ length: 40 }, (_, i) => `Line number ${i + 1} of the sample reading`).join("\n")
    };
    const base = await request(app).post("/api/preview-reading").send(body).expect(200);
    const large = await request(app)
      .post("/api/preview-reading")
      .send({ ...body, overrideSettings: { readingTextSizePx: 200 } })
      .expect(200);

    expect(large.body.slides.length).toBeGreaterThan(base.body.slides.length);
  });

  test("preview-manual-slide splits hymn text by size and honors draft settings", async () => {
    const body = {
      type: "hymn",
      label: "Hymn",
      phase: "mass",
      backgroundTheme: "dark",
      manualSlide: {
        text: Array.from({ length: 12 }, (_, i) => `Verse line ${i + 1}`).join("\n")
      }
    };
    const small = await request(app)
      .post("/api/preview-manual-slide")
      .send({ ...body, overrideSettings: { textSlideTextSizePx: 40, hymnTextSizePx: 40 } })
      .expect(200);
    const large = await request(app)
      .post("/api/preview-manual-slide")
      .send({ ...body, overrideSettings: { textSlideTextSizePx: 150, hymnTextSizePx: 150 } })
      .expect(200);

    expect(small.body.slides).toHaveLength(1);
    expect(large.body.slides.length).toBeGreaterThan(1);
    expect(large.body.slides.at(-1).totalPages).toBe(large.body.slides.length);
    expect(large.body.slides.map((slide) => slide.text).join("\n")).toBe(body.manualSlide.text);
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

  test("preview-reading shows a sample reading when no stem is given", async () => {
    const res = await request(app)
      .post("/api/preview-reading")
      .send({
        label: "Sample Reading",
        passage: "Revelation 3:9",
        text: "Behold, I will make those of the assembly of Satan come and fall prostrate at your feet."
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.slides.length).toBeGreaterThan(0);
    expect(res.body.slides[0].type).toBe("reading");
    expect(res.body.slides[0].passage).toBe("Revelation 3:9");
    expect(res.body.slides[0].groupLabel).toBe("Sample Reading");
  });

  test("preview-reading paginates with the unsaved text bounds", async () => {
    const text = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of a long reading that needs more than one page.`).join("\n");
    const preview = async (overrideSettings) => (await request(app)
      .post("/api/preview-reading")
      .send({ label: "Sample Reading", passage: "Revelation 3:9", text, overrideSettings })
      .expect(200)).body.slides;

    const saved = await preview(undefined);
    const bounds = JSON.parse(JSON.stringify((await request(app).get("/api/state")).body.screenSettings.textBounds));
    bounds.readingBody.bottom = 500;
    const tight = await preview({ textBounds: bounds });

    expect(tight.length).toBeGreaterThan(saved.length);
  });

  test("preview-reading returns 404 for an unknown stem", async () => {
    await request(app)
      .post("/api/preview-reading")
      .send({ stem: "Missing_Stem", text: "Text" })
      .expect(404);
  });

  test("preview-reading uses the same page breaks as the projector", async () => {
    const readingsDir = path.join(handle.homeDir, "preview-pagination");
    fs.mkdirSync(readingsDir, { recursive: true });
    const longText = Array.from({ length: 12 }, (_, index) =>
      `Verse ${index + 1}: They devoted themselves to the teaching of the apostles and to the communal life.`
    ).join("\n");
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), `Acts of the Apostles 2:42-47\n\n${longText}`, "utf8");

    const before = (await request(app).get("/api/state").expect(200)).body.screenSettings.textBounds;
    const narrowBody = { left: 600, right: 600, top: 300, bottom: 400 };
    try {
      await request(app)
        .post("/api/screen-settings")
        .send({ textBounds: { ...before, readingBody: narrowBody } })
        .expect(200);
      await request(app)
        .post("/api/load-readings")
        .send({ folderPath: readingsDir })
        .expect(200);

      const live = (await request(app).get("/api/state").expect(200)).body;
      const doc = live.readingsSource.documents.find((entry) => entry.stem === "Reading_I");
      const projectorSlides = live.presentation.slides.filter((slide) => String(slide.id).startsWith("reading-Reading_I-"));
      expect(projectorSlides.length).toBeGreaterThan(1);

      const preview = await request(app)
        .post("/api/preview-reading")
        .send({ stem: "Reading_I", text: doc.textLines.join("\n") })
        .expect(200);

      expect(preview.body.slides.map((slide) => slide.text)).toEqual(projectorSlides.map((slide) => slide.text));
    } finally {
      await request(app)
        .post("/api/screen-settings")
        .send({ textBounds: before })
        .expect(200);
    }
  });

  test("load-readings asks which alternate to keep and leaves the unused file on disk", async () => {
    const readingsDir = path.join(handle.homeDir, "alternate-readings");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Gospel.txt"), "John 1:1-5\n\nIn the beginning was the Word.", "utf8");
    fs.writeFileSync(
      path.join(readingsDir, "Gospel-alternate_1.txt"),
      "John 20:1-9\n\nOn the first day of the week.",
      "utf8"
    );

    const ask = await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(409);
    expect(ask.body.code).toBe("alternate-choice-required");
    expect(ask.body.alternateGroups).toEqual([
      { key: "Gospel", options: ["Gospel", "Gospel-alternate_1"] }
    ]);

    await request(app)
      .post("/api/load-readings")
      .send({ folderPath: readingsDir, alternateSelections: { Gospel: "Gospel-alternate_1" } })
      .expect(200);

    const state = (await request(app).get("/api/state").expect(200)).body;
    const gospels = state.organizerSequence.filter((item) => item.type === "reading");
    expect(gospels.map((item) => item.sourceStem)).toEqual(["Gospel-alternate_1"]);
    expect(state.readingsSource.documents.map((doc) => doc.stem).sort()).toEqual(["Gospel", "Gospel-alternate_1"]);
  });

  test("load-readings insert keeps organizer item IDs unique", async () => {
    const readingsDir = path.join(handle.homeDir, "insert-duplicate-stem");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.", "utf8");

    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);
    await request(app)
      .post("/api/load-readings")
      .send({ folderPath: readingsDir, insertAtIndex: 0 })
      .expect(200);

    const state = (await request(app).get("/api/state").expect(200)).body;
    const ids = state.organizerSequence.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    const slideItemIds = [...new Set(state.presentation.slides.map((slide) => slide.organizerItemId))];
    expect(slideItemIds.sort()).toEqual([...ids].sort());

    await request(app)
      .post("/api/organizer")
      .send({ sequence: state.organizerSequence, manualSlides: state.manualSlides })
      .expect(200);
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

  test("save-reading replaces the reading file without a temporary file", async () => {
    const readingsDir = path.join(handle.homeDir, "save-reading-atomic");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.", "utf8");
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);

    const readingPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "Reading_I.txt");
    await request(app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "Updated by the operator." })
      .expect(200);

    expect(fs.readFileSync(readingPath, "utf8")).toContain("Updated by the operator.");
    expect(fs.readdirSync(path.dirname(readingPath)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("save-reading keeps the prior reading when the replace fails", async () => {
    const readingsDir = path.join(handle.homeDir, "save-reading-failure");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.", "utf8");
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);

    const readingPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "Reading_I.txt");
    const prior = fs.readFileSync(readingPath, "utf8");
    const realRename = fs.renameSync;
    jest.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (path.resolve(String(to)) === path.resolve(readingPath)) {
        throw new Error("rename failed");
      }
      return realRename(from, to);
    });

    await request(app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "This text must not persist." })
      .expect(500);

    expect(fs.readFileSync(readingPath, "utf8")).toBe(prior);
    expect(fs.readdirSync(path.dirname(readingPath)).filter((name) => name.includes(".tmp-"))).toEqual([]);
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

  test("clearing the Mass title removes the stale mass_title.txt file", async () => {
    const readingsDir = path.join(handle.homeDir, "title-clear-readings");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.");
    fs.writeFileSync(path.join(readingsDir, "mass_title.txt"), "Old Title\n");
    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));

    const titleFile = path.join(handle.homeDir, ".sacra-lux", "current_mass", "mass_title.txt");
    expect(fs.readFileSync(titleFile, "utf8")).toBe("Old Title\n");

    await request(app).post("/api/update-title").send({ title: "New Title" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(fs.readFileSync(titleFile, "utf8")).toBe("New Title\n");

    await request(app).post("/api/update-title").send({ title: "" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(fs.existsSync(titleFile)).toBe(false);
  });

  test("oversized JSON bodies get HTTP 413 before route logic runs", async () => {
    const big = "x".repeat(11 * 1024 * 1024);
    const smallRoute = await request(app).post("/api/update-title").send({ title: big });
    expect(smallRoute.status).toBe(413);
    expect(smallRoute.body.error).toBeTruthy();

    // Mass ZIP import above its 68 MB body limit is rejected the same way.
    const zipRoute = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: "A".repeat(69 * 1024 * 1024) });
    expect(zipRoute.status).toBe(413);

    // Other clients still get state while oversized requests arrive.
    await request(app).get("/api/state").expect(200);
  });

  test("unauthorized upload requests get HTTP 401 before the body arrives", async () => {
    await request(app).post("/api/start-pin").send({ pin: "2468" }).expect(200);

    // Declare a 200 MB body but send only the headers and one chunk.
    // A 401 can arrive only if the server answers without reading the body.
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        `${handle.baseUrl}/api/upload-mass-asset`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(200 * 1024 * 1024)
          }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
          req.destroy();
        }
      );
      req.on("error", (err) => {
        if (err.code !== "ECONNRESET") reject(err);
      });
      req.write("{\"filename\":\"a.png\",");
    });
    expect(status).toBe(401);

    await request(app).get("/api/state").expect(200);
  });

  test("authorized uploads keep their route limits after the authorization check", async () => {
    const pinResponse = await request(app).post("/api/start-pin").send({ pin: "2468" }).expect(200);
    const controlToken = pinResponse.body.controlToken;

    await request(app)
      .post("/api/upload-mass-asset")
      .set("x-sacra-control", controlToken)
      .send({ filename: "Limit.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    const tooBig = await request(app)
      .post("/api/update-title")
      .set("x-sacra-control", controlToken)
      .send({ title: "x".repeat(11 * 1024 * 1024) });
    expect(tooBig.status).toBe(413);
  });

  test("upload route accepts a maximum-size MP4 and rejects one byte more", async () => {
    const { MAX_SINGLE_UPLOAD_BYTES } = require("../../src/uploadLimits");
    const toDataUrl = (size) => `data:video/mp4;base64,${Buffer.alloc(size).toString("base64")}`;

    const accepted = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Maximum.mp4", dataUrl: toDataUrl(MAX_SINGLE_UPLOAD_BYTES) })
      .expect(200);
    expect(accepted.body.url).toBe("/api/mass-asset/Maximum.mp4");
    const storedPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets", "Maximum.mp4");
    expect(fs.statSync(storedPath).size).toBe(MAX_SINGLE_UPLOAD_BYTES);

    const rejected = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Over.mp4", dataUrl: toDataUrl(MAX_SINGLE_UPLOAD_BYTES + 1) });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toContain("140 MB limit");
    expect(fs.existsSync(path.join(path.dirname(storedPath), "Over.mp4"))).toBe(false);
  });

  test("upload routes accept bodies above the default JSON limit", async () => {
    const padding = "A".repeat(11 * 1024 * 1024);
    const res = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: padding });
    // The body parser accepts it; ZIP validation rejects the content.
    expect(res.status).not.toBe(413);
  });

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
    const appDir = path.dirname(currentMassDir);
    const stagingEntriesBefore = fs.readdirSync(appDir).filter((name) => name.startsWith(".current_mass-"));
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
      .expect(400);

    const nullZip = new AdmZip();
    nullZip.addFile("mass.json", Buffer.from("null"));
    const nullImport = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: nullZip.toBuffer().toString("base64") });
    expect(nullImport.status).toBe(400);
    expect(nullImport.body.error).toBe("Mass definition must be a JSON object.");

    expect(snapshotTree(currentMassDir)).toEqual(before);
    expect(fs.readdirSync(appDir).filter((name) => name.startsWith(".current_mass-")))
      .toEqual(stagingEntriesBefore);
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

  test("rejects ZIP metadata that exceeds each configured resource limit", () => {
    const entry = (name, size) => ({ entryName: name, header: { size } });
    const archive = (...entries) => ({ getEntries: () => entries });

    expect(() => validateMassZipArchive(
      archive(entry("mass.json", 1)),
      MASS_ZIP_LIMITS.maxCompressedBytes + 1
    )).toThrow(/compressed size exceeds/i);
    expect(() => validateMassZipArchive(
      archive(...Array.from({ length: MASS_ZIP_LIMITS.maxEntries + 1 }, (_, index) => entry(`file-${index}`, 1))),
      1
    )).toThrow(/too many entries/i);
    expect(() => validateMassZipArchive(
      archive(entry("large.bin", MASS_ZIP_LIMITS.maxEntryBytes + 1)),
      1
    )).toThrow(/entry .* exceeds/i);
    expect(() => validateMassZipArchive(
      archive(
        ...Array.from({ length: 5 }, (_, index) => entry(`large-${index}.bin`, MASS_ZIP_LIMITS.maxEntryBytes)),
        entry("overflow.bin", 1)
      ),
      1
    )).toThrow(/uncompressed size exceeds/i);
  });

  test("rejects a too-many-entry ZIP before replacing current_mass", async () => {
    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    const canaryPath = path.join(currentMassDir, "resource-limit-canary.txt");
    fs.writeFileSync(canaryPath, "keep", "utf8");

    const zip = new AdmZip();
    zip.addFile("mass.json", Buffer.from(JSON.stringify({
      version: 2,
      presentationTitle: "Should Not Import",
      screenSettings: {},
      organizerSequence: [],
      manualSlides: {}
    })));
    for (let index = 0; index <= MASS_ZIP_LIMITS.maxEntries; index += 1) {
      zip.addFile(`readings/extra-${index}.txt`, Buffer.from("x"));
    }

    const response = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/too many entries/i);
    expect(fs.readFileSync(canaryPath, "utf8")).toBe("keep");
    expect(fs.readdirSync(path.dirname(currentMassDir)).filter((name) => name.startsWith(".current_mass-")))
      .toEqual([]);
  });

  test("import-mass-zip rejects non-object JSON and unsupported mass versions", async () => {
    const importDefinition = (definition) => {
      const zip = new AdmZip();
      zip.addFile("mass.json", Buffer.from(JSON.stringify(definition)));
      return request(app)
        .post("/api/import-mass-zip")
        .send({ zipData: zip.toBuffer().toString("base64") });
    };

    for (const value of [[], "text", 7, true]) {
      const response = await importDefinition(value);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Mass definition must be a JSON object.");
    }

    for (const version of [4, 2, undefined, "3"]) {
      const response = await importDefinition({ format: "sacra-lux.mass", version, items: [] });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Unsupported mass version.");
    }
  });

  test("import-mass-zip rejects an entry whose content exceeds its declared size", async () => {
    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    const canaryPath = path.join(currentMassDir, "declared-size-canary.txt");
    fs.writeFileSync(canaryPath, "keep", "utf8");

    const zip = new AdmZip();
    zip.addFile("mass.json", Buffer.from(JSON.stringify({ presentationTitle: "Should Not Import" })));
    zip.addFile("assets/big.png", Buffer.alloc(1024 * 1024, 1));
    const zipBuf = zip.toBuffer();
    // Set the declared size of every entry to 100 bytes in both ZIP headers.
    const patchSize = (signature, offset) => {
      const sig = Buffer.from(signature, "hex");
      for (let at = zipBuf.indexOf(sig); at >= 0; at = zipBuf.indexOf(sig, at + 4)) {
        zipBuf.writeUInt32LE(100, at + offset);
      }
    };
    patchSize("504b0102", 24);
    patchSize("504b0304", 22);

    const response = await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zipBuf.toString("base64") });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/declared size/i);
    expect(fs.readFileSync(canaryPath, "utf8")).toBe("keep");
    expect(fs.readdirSync(path.dirname(currentMassDir)).filter((name) => name.startsWith(".current_mass-")))
      .toEqual([]);
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

  test("preview-manual-slide keeps only known countdown font names", async () => {
    const basePayload = {
      type: "countdown",
      label: "Mass starts in",
      phase: "pre",
      backgroundTheme: "light",
      manualSlide: {
        text: "",
        countdownSec: 60,
        countdownStyle: "ring"
      }
    };

    const markupRes = await request(app)
      .post("/api/preview-manual-slide")
      .send({ ...basePayload, manualSlide: { ...basePayload.manualSlide, countdownFont: '<img src=x onerror=alert(1)>' } })
      .expect(200);

    expect(markupRes.body.slides[0].countdownFont).toBe("");
    expect(JSON.stringify(markupRes.body)).not.toContain("<img");

    const validRes = await request(app)
      .post("/api/preview-manual-slide")
      .send({ ...basePayload, manualSlide: { ...basePayload.manualSlide, countdownFont: "Open Sans" } })
      .expect(200);

    expect(validRes.body.slides[0].countdownFont).toBe("Open Sans");
  });

  test("organizer endpoint validates sequence payload", async () => {
    const before = JSON.stringify(state.organizerSequence);
    const res = await request(app)
      .post("/api/organizer")
      .send({ sequence: "not-an-array" })
      .expect(400);

    expect(res.body.error).toMatch(/sequence array is required/i);
    expect(JSON.stringify(state.organizerSequence)).toBe(before);
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

  test("screen settings keep independent valid text bounds", async () => {
    const res = await request(app)
      .post("/api/screen-settings")
      .send({
        textBounds: {
          readingBody: { left: 100, right: 120, top: 140, bottom: 160 },
          readingPassage: { left: 200, right: 800, top: 50, bottom: 900 },
          hymn: { left: 300, right: 320, top: 180, bottom: 200 },
          prayer: { left: 400, right: 420, top: 220, bottom: 240 },
          text: { left: -10, right: 5000, top: "bad", bottom: 5000 }
        }
      })
      .expect(200);

    expect(res.body.screenSettings.textBounds.readingBody).toEqual({ left: 100, right: 120, top: 140, bottom: 160 });
    expect(res.body.screenSettings.textBounds.readingPassage).toEqual({ left: 200, right: 800, top: 50, bottom: 900 });
    expect(res.body.screenSettings.textBounds.hymn).toEqual({ left: 300, right: 320, top: 180, bottom: 200 });
    expect(res.body.screenSettings.textBounds.prayer).toEqual({ left: 400, right: 420, top: 220, bottom: 240 });
    expect(res.body.screenSettings.textBounds.text.left).toBe(0);
    expect(1920 - res.body.screenSettings.textBounds.text.left - res.body.screenSettings.textBounds.text.right)
      .toBeGreaterThanOrEqual(120);
    expect(1080 - res.body.screenSettings.textBounds.text.top - res.body.screenSettings.textBounds.text.bottom)
      .toBeGreaterThanOrEqual(80);
  });

  test("screen settings toggle the spoken reading ending", async () => {
    await request(app)
      .post("/api/screen-settings")
      .send({ readingShowEnding: false })
      .expect(200);

    let stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.screenSettings.readingShowEnding).toBe(false);

    await request(app)
      .post("/api/screen-settings")
      .send({ readingShowEnding: true })
      .expect(200);

    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.screenSettings.readingShowEnding).toBe(true);
  });

  test("mass asset upload preserves the original filename safely", async () => {
    const res = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Sanctuary Lamp.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    const storedName = String(res.body.url || "").split("/").pop();
    expect(storedName).toBe("Sanctuary Lamp.png");
    expect(res.body.name).toBe("Sanctuary Lamp.png");

    const assetPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets", storedName);
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  test("mass asset upload strips unsafe filename characters and avoids collisions", async () => {
    const first = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "../../unsafe<script>.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const second = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "../../unsafe<script>.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    expect(first.body.url).toMatch(/unsafe?script\.png$/);
    expect(second.body.url).toMatch(/unsafe?script \(1\)\.png$/);
    expect(first.body.url).not.toBe(second.body.url);
  });

  test("mass asset upload never overwrites a file created after the name check", async () => {
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const racedPath = path.join(assetsDir, "Raced.png");
    fs.writeFileSync(racedPath, "earlier upload bytes");

    // Hide the existing file from the first name check to simulate the race.
    const realExists = fs.existsSync;
    let hidden = false;
    const existsSpy = jest.spyOn(fs, "existsSync").mockImplementation((target) => {
      if (!hidden && target === racedPath) {
        hidden = true;
        return false;
      }
      return realExists(target);
    });
    let res;
    try {
      res = await request(app)
        .post("/api/upload-mass-asset")
        .send({ filename: "Raced.png", dataUrl: tinyPngDataUrl })
        .expect(200);
    } finally {
      existsSpy.mockRestore();
    }

    expect(hidden).toBe(true);
    expect(fs.readFileSync(racedPath, "utf8")).toBe("earlier upload bytes");
    expect(res.body.url).toBe("/api/mass-asset/Raced (1).png");
    expect(fs.existsSync(path.join(assetsDir, "Raced (1).png"))).toBe(true);
  });

  test("concurrent uploads with one filename save under unique names", async () => {
    const dataUrls = [
      tinyPngDataUrl,
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    ];
    const responses = await Promise.all(
      dataUrls.map((dataUrl) =>
        request(app).post("/api/upload-mass-asset").send({ filename: "Same.png", dataUrl }).expect(200)
      )
    );

    const urls = responses.map((res) => res.body.url);
    expect(new Set(urls).size).toBe(2);
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    responses.forEach((res, index) => {
      const stored = fs.readFileSync(path.join(assetsDir, res.body.url.split("/").pop()));
      expect(stored.equals(Buffer.from(dataUrls[index].split(",")[1], "base64"))).toBe(true);
    });
  });

  test("folder slideshow import saves a bounded batch of image assets", async () => {
    const res = await request(app)
      .post("/api/import-slideshow-images")
      .send({
        images: [
          { filename: "Summer Photos/Photo 2.png", dataUrl: tinyPngDataUrl },
          { filename: "Summer Photos/Photo 10.png", dataUrl: tinyPngDataUrl }
        ]
      })
      .expect(200);

    expect(res.body.images).toEqual([
      expect.objectContaining({ url: "/api/mass-asset/Photo 2.png", name: "Photo 2.png" }),
      expect.objectContaining({ url: "/api/mass-asset/Photo 10.png", name: "Photo 10.png" })
    ]);
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    expect(fs.existsSync(path.join(assetsDir, "Photo 2.png"))).toBe(true);
    expect(fs.existsSync(path.join(assetsDir, "Photo 10.png"))).toBe(true);
  });

  test("folder slideshow import removes saved files when a later write fails", async () => {
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    const before = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).sort() : [];
    const realWrite = fs.writeFileSync;
    let writes = 0;
    const writeSpy = jest.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
      // Background persistence also writes; count only writes into the assets directory.
      if (path.dirname(String(args[0])) === assetsDir) {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
      }
      return realWrite(...args);
    });
    try {
      const res = await request(app)
        .post("/api/import-slideshow-images")
        .send({
          images: [
            { filename: "Rollback One.png", dataUrl: tinyPngDataUrl },
            { filename: "Rollback Two.png", dataUrl: tinyPngDataUrl }
          ]
        })
        .expect(500);
      expect(res.body.error).toMatch(/disk full/);
    } finally {
      writeSpy.mockRestore();
    }

    expect(fs.readdirSync(assetsDir).sort()).toEqual(before);
  });

  test("folder slideshow import rejects non-image assets", async () => {
    const res = await request(app)
      .post("/api/import-slideshow-images")
      .send({ images: [{ filename: "clip.mp4", dataUrl: "data:video/mp4;base64,AAAA" }] })
      .expect(400);

    expect(res.body.error).toMatch(/unsupported media type/i);
  });

  test("mass asset route rejects invalid filenames", async () => {
    const res = await request(app)
      .get("/api/mass-asset/bad:name.png")
      .expect(400);

    expect(String(res.body.error || "")).toMatch(/invalid filename/i);
  });

  test("mass asset route returns not found for a missing file", async () => {
    const res = await request(app)
      .get("/api/mass-asset/missing.png")
      .expect(404);

    expect(String(res.body.error || "")).toMatch(/not found|no mass folder/i);
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

  test("image slideshow keeps fade transitions inside exact image intervals", async () => {
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Slideshow Timer", startTime: "" })
      .expect(200);
    const first = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "First.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    const second = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Second.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "slideshow:timer", type: "imageSlideshow", label: "Two images", phase: "mass", backgroundTheme: "light", durationSec: 1 },
          { id: "text:after", type: "text", label: "After", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "slideshow:timer": {
            images: [
              { url: first.body.url, name: "First.png" },
              { url: second.body.url, name: "Second.png" }
            ],
            slideshowDurationSec: 1,
            slideshowLoopCount: 1
          },
          "text:after": { text: "Finished" }
        }
      })
      .expect(200);

    await wait(1100);
    let stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(1);
    expect(stateRes.body.imageSlideshowLoopIteration).toBe(1);
    expect(stateRes.body.imageSlideshowEndsAt).not.toBeNull();

    await wait(1100);
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.currentSlideIndex).toBe(2);
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

    const emitSpy = jest.spyOn(handle.io, "emit");
    emitSpy.mockClear();
    await request(app)
      .post("/api/mass-history/History-One/load")
      .expect(200);
    expect(emitSpy).toHaveBeenCalledWith("state:update", expect.any(Object));

    await request(app)
      .post("/api/mass-history/History-Two/load")
      .expect(200);

    await request(app)
      .delete("/api/mass-history/History-One")
      .expect(200);
    historyRes = await request(app).get("/api/mass-history").expect(200);
    expect(historyRes.body.archives.map((entry) => entry.id)).not.toContain("History-One");
    emitSpy.mockRestore();
  });

  test("mass history routes reject an unknown archive", async () => {
    await request(app)
      .post("/api/mass-history/Unknown-Archive/load")
      .expect(404);
    await request(app)
      .post("/api/mass-history/Unknown-Archive/compress")
      .expect(404);
    await request(app)
      .delete("/api/mass-history/Unknown-Archive")
      .expect(404);
  });

  test("load-readings failure keeps the current slides", async () => {
    const readingsDir = path.join(handle.homeDir, "load-readings-failure");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.", "utf8");

    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);
    const before = (await request(app).get("/api/state").expect(200)).body;

    await request(app)
      .post("/api/load-readings")
      .send({ folderPath: path.join(handle.homeDir, "does-not-exist") })
      .expect(400);

    const after = (await request(app).get("/api/state").expect(200)).body;
    expect(after.presentation.slides).toEqual(before.presentation.slides);
    expect(after.readingsSource.documents).toEqual(before.readingsSource.documents);
  });

  test("save-reading rebuilds the reading slides", async () => {
    const readingsDir = path.join(handle.homeDir, "save-reading-slides");
    fs.mkdirSync(readingsDir, { recursive: true });
    fs.writeFileSync(path.join(readingsDir, "Reading_I.txt"), "Genesis 1:1\n\nShort text.", "utf8");

    await request(app).post("/api/load-readings").send({ folderPath: readingsDir }).expect(200);
    const before = (await request(app).get("/api/state").expect(200)).body.presentation.slides.length;
    const longText = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join("\n");

    await request(app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: longText })
      .expect(200);

    const after = (await request(app).get("/api/state").expect(200)).body.presentation.slides.length;
    expect(after).toBeGreaterThan(before);
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

  test("the organizer keeps a ten minute countdown and rejects lengths out of range", async () => {
    const send = (countdownSec) => request(app)
      .post("/api/organizer")
      .send({
        sequence: [{ id: "countdown:long", type: "countdown", label: "Timer", phase: "pre", backgroundTheme: "dark", durationSec: 10 }],
        manualSlides: { "countdown:long": { text: "", countdownSec } }
      });

    await send(600).expect(200);
    let stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.slides[0].countdownSec).toBe(600);

    for (const bad of [0, 3601]) {
      const res = await send(bad).expect(400);
      expect(res.body.error).toMatch(/between 1 second and 60 minutes/);
    }
    stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.slides[0].countdownSec).toBe(600);
  });

  test("the organizer drops countdown font markup before it reaches the state", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "countdown:guard", type: "countdown", label: "Timer", phase: "pre", backgroundTheme: "dark", durationSec: 10 },
          { id: "countdown:after", type: "text", label: "After", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "countdown:guard": { text: "", countdownSec: 30, countdownFont: '<img src=x onerror=alert(1)>', countdownStyle: "ring", countdownSizePercent: 100 },
          "countdown:after": { text: "After", notes: "", textVAlign: "middle", imageUrl: null }
        }
      })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.manualSlides["countdown:guard"].countdownFont).toBe("");
    expect(JSON.stringify(stateRes.body)).not.toContain("<img");
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

  test("import-mass-zip rejects traversal entries and accepts safe entries", async () => {
    expect(() => validateMassZipArchive({
      getEntries: () => [{ entryName: "readings/../../evil.txt", header: { size: 0 } }]
    }, 0)).toThrow("leaves the package folder");

    const zip = new AdmZip();
    zip.addFile("settings.json", Buffer.from(JSON.stringify({
      version: 2,
      presentationTitle: "Imported Mass",
      screenSettings: {},
      organizerSequence: [],
      manualSlides: {}
    })));
    zip.addFile("readings/Reading_I.txt", Buffer.from("Genesis 1:1-3\n\nIn the beginning."));
    zip.addFile("readings/assets/safe.png", Buffer.from("safe-image"));
    zip.addFile("uploads/uploaded.png", Buffer.from("uploaded-image"));

    const before = await request(app).get("/api/state").expect(200);
    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    const after = await request(app).get("/api/state").expect(200);
    expect(after.body).not.toEqual(before.body);
    expect(fs.existsSync(path.join(currentMassDir, "Reading_I.txt"))).toBe(true);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "safe.png"))).toBe(true);
    expect(fs.existsSync(path.join(currentMassDir, "assets", "uploaded.png"))).toBe(true);
  });

  test("import-mass-zip rewrites legacy /static/uploads/ references to served assets", async () => {
    const zip = new AdmZip();
    zip.addFile("settings.json", Buffer.from(JSON.stringify({
      version: 2,
      presentationTitle: "Legacy Uploads",
      screenSettings: {},
      organizerSequence: [{ id: "image-1", type: "image", label: "Picture", phase: "mass" }],
      manualSlides: { "image-1": { imageUrl: "/static/uploads/a.png" } }
    })));
    zip.addFile("uploads/a.png", Buffer.from("legacy-image"));

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    const savedDefinition = fs.readFileSync(path.join(currentMassDir, "mass.json"), "utf8");
    expect(savedDefinition).toContain("/api/mass-asset/a.png");
    expect(savedDefinition).not.toContain("/static/uploads/");
    const asset = await request(app).get("/api/mass-asset/a.png").expect(200);
    expect(asset.body.toString()).toBe("legacy-image");
  });

  test("a normal Mass save does not write the saved path to the console", () => {
    const { saveCurrentMass } = require("../../src/server");
    const logger = require("../../src/logger");
    const wasQuiet = logger.isQuietLogs();
    logger.setQuietLogs(false);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });
    try {
      saveCurrentMass();
      const logged = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).not.toContain("[save] Mass saved to");
      const massJson = path.join(handle.homeDir, ".sacra-lux", "current_mass", "mass.json");
      expect(fs.existsSync(massJson)).toBe(true);
    } finally {
      logSpy.mockRestore();
      logger.setQuietLogs(wasQuiet);
    }
  });

  test("import-mass-zip resolves media name collisions by folder, not ZIP order", async () => {
    const buildZip = (entries) => {
      const zip = new AdmZip();
      zip.addFile("settings.json", Buffer.from(JSON.stringify({
        version: 2,
        presentationTitle: "Collisions",
        screenSettings: {},
        organizerSequence: [],
        manualSlides: {}
      })));
      for (const [name, text] of entries) zip.addFile(name, Buffer.from(text));
      return zip.toBuffer().toString("base64");
    };
    const entries = [
      ["uploads/x.png", "from-uploads"],
      ["readings/assets/x.png", "from-readings-assets"],
      ["assets/x.png", "from-assets"],
      ["uploads/y.png", "y-uploads"],
      ["readings/assets/y.png", "y-readings-assets"],
      ["uploads/z.png", "z-uploads"]
    ];
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    const readAsset = (name) => fs.readFileSync(path.join(assetsDir, name), "utf8");

    for (const ordered of [entries, [...entries].reverse()]) {
      await request(app)
        .post("/api/import-mass-zip")
        .send({ zipData: buildZip(ordered) })
        .expect(200);
      expect(readAsset("x.png")).toBe("from-assets");
      expect(readAsset("y.png")).toBe("y-readings-assets");
      expect(readAsset("z.png")).toBe("z-uploads");
    }
  });

  test("import-settings keeps state unchanged when the start time is invalid", async () => {
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{ id: "text-1", type: "text", label: "Welcome", phase: "mass" }],
        manualSlides: { "text-1": { text: "Before" } }
      })
      .expect(200);
    const before = await request(app).get("/api/state").expect(200);

    await request(app)
      .post("/api/import-settings")
      .send({
        organizerSequence: [],
        manualSlides: {},
        massStartTime: "not-a-date"
      })
      .expect(400);

    const after = await request(app).get("/api/state").expect(200);
    expect(after.body).toEqual(before.body);
  });

  test("import-mass-zip keeps the current package when the ZIP is corrupt", async () => {
    const currentMassDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "keep.txt"), "keep", "utf8");
    const before = await request(app).get("/api/state").expect(200);

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: Buffer.from("not a zip").toString("base64") })
      .expect((response) => expect(response.status).toBeGreaterThanOrEqual(400));

    expect(fs.readFileSync(path.join(currentMassDir, "keep.txt"), "utf8")).toBe("keep");
    const after = await request(app).get("/api/state").expect(200);
    expect(after.body).toEqual(before.body);
  });

  test("export-mass-zip writes a v3 mass.json document without PIN data", async () => {
    const pinResponse = await request(app)
      .post("/api/start-pin")
      .send({ pin: "2468" })
      .expect(200);

    await request(app)
      .post("/api/new-mass")
      .set("x-sacra-control", pinResponse.body.controlToken)
      .send({ title: "Document Export", startTime: "2026-04-20T09:00" })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .set("x-sacra-control", pinResponse.body.controlToken)
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
      .set("x-sacra-control", pinResponse.body.controlToken)
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

  test("Mass exports require and bind a control session when a PIN exists", async () => {
    const pinResponse = await request(app)
      .post("/api/start-pin")
      .send({ pin: "2468" })
      .expect(200);
    const controlToken = pinResponse.body.controlToken;

    await request(app)
      .post("/api/new-mass")
      .set("x-sacra-control", controlToken)
      .send({ title: "Protected Export", startTime: "" })
      .expect(200);

    await request(app).get("/api/export-mass-zip").expect(401);
    await request(app)
      .get("/api/export-mass-zip")
      .set("x-sacra-control", controlToken)
      .expect(200);

    const { token: avifToken } = await createAvifExport(controlToken);
    const secondSession = await request(app)
      .post("/api/verify-pin")
      .send({ pin: "2468" })
      .expect(200);
    await request(app)
      .get(`/api/export-mass-zip-avif?token=${avifToken}`)
      .expect(401);
    await request(app)
      .get(`/api/export-mass-zip-avif?token=${avifToken}`)
      .set("x-sacra-control", secondSession.body.controlToken)
      .expect(401);
    await request(app)
      .get(`/api/export-mass-zip-avif?token=${avifToken}`)
      .set("x-sacra-control", controlToken)
      .expect(200);
    await request(app)
      .get(`/api/export-mass-zip-avif?token=${avifToken}`)
      .set("x-sacra-control", controlToken)
      .expect(404);
  });

  test("AVIF export keeps assets with the same stem as distinct files", async () => {
    const sharp = require("sharp");
    const toDataUrl = async (format, color) => {
      const buffer = await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
        [format]()
        .toBuffer();
      return `data:image/${format === "jpeg" ? "jpeg" : "png"};base64,${buffer.toString("base64")}`;
    };
    const jpgUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "banner.jpg", dataUrl: await toDataUrl("jpeg", "#ff0000") })
      .expect(200);
    const pngUpload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "banner.png", dataUrl: await toDataUrl("png", "#0000ff") })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{ id: "banners", type: "imageSlideshow", label: "Banners", phase: "mass", backgroundTheme: "light" }],
        manualSlides: {
          banners: {
            images: [
              { url: jpgUpload.body.url, name: "banner.jpg" },
              { url: pngUpload.body.url, name: "banner.png" }
            ],
            slideshowDurationSec: 5,
            slideshowLoopCount: 1
          }
        }
      })
      .expect(200);

    const { token } = await createAvifExport(undefined);
    const zipRes = await request(app)
      .get(`/api/export-mass-zip-avif?token=${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const exportedZip = new AdmZip(zipRes.body);
    const massDocument = JSON.parse(exportedZip.getEntry("mass.json").getData().toString("utf8"));
    const item = massDocument.items.find((entry) => entry.id === "banners");
    const refs = item.assets.map((asset) => asset.ref);
    expect(new Set(refs).size).toBe(2);
    const pixels = [];
    for (const ref of refs) {
      expect(ref).toMatch(/\.avif$/);
      const entry = exportedZip.getEntry(ref);
      expect(entry).toBeTruthy();
      const { data } = await sharp(entry.getData()).raw().toBuffer({ resolveWithObject: true });
      pixels.push([data[0], data[1], data[2]]);
    }
    // Red JPEG first, blue PNG second; each reference keeps its own pixels.
    expect(pixels[0][0]).toBeGreaterThan(pixels[0][2]);
    expect(pixels[1][2]).toBeGreaterThan(pixels[1][0]);
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

  test("import-mass-zip canonicalizes an out-of-order legacy package by phase", async () => {
    const zip = new AdmZip();
    zip.addFile("settings.json", Buffer.from(JSON.stringify({
      version: 2,
      presentationTitle: "Out Of Order",
      screenSettings: {},
      organizerSequence: [
        { id: "post-1", type: "text", label: "Post A", phase: "post" },
        { id: "gather-1", type: "text", label: "Gather A", phase: "gathering" },
        { id: "mass-1", type: "text", label: "Mass A", phase: "mass" },
        { id: "pre-1", type: "text", label: "Pre A", phase: "pre" },
        { id: "mass-2", type: "text", label: "Mass B", phase: "mass" },
        { id: "pre-2", type: "text", label: "Pre B", phase: "pre" }
      ],
      manualSlides: {}
    })));

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.organizerSequence.map((item) => item.id))
      .toEqual(["pre-1", "pre-2", "gather-1", "mass-1", "mass-2", "post-1"]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const saved = JSON.parse(fs.readFileSync(
      path.join(handle.homeDir, ".sacra-lux", "current_mass", "mass.json"),
      "utf8"
    ));
    expect(saved.items.map((item) => item.id))
      .toEqual(["pre-1", "pre-2", "gather-1", "mass-1", "mass-2", "post-1"]);
  });

  test("import-mass-zip canonicalizes an out-of-order v3 package by phase", async () => {
    const zip = new AdmZip();
    zip.addFile("mass.json", Buffer.from(JSON.stringify({
      format: "sacra-lux.mass",
      version: 3,
      metadata: { title: "Out Of Order V3" },
      items: [
        { id: "post-1", kind: "text", label: "Post", section: "post", content: { text: "p" } },
        { id: "gather-1", kind: "text", label: "Gather", section: "gathering", content: { text: "g" } },
        { id: "mass-1", kind: "text", label: "Mass", section: "mass", content: { text: "m" } },
        { id: "pre-1", kind: "text", label: "Pre", section: "pre", content: { text: "r" } }
      ]
    })));

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: zip.toBuffer().toString("base64") })
      .expect(200);

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.organizerSequence.map((item) => item.id))
      .toEqual(["pre-1", "gather-1", "mass-1", "post-1"]);
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

  test("global api limiter does not count Mass asset reads", async () => {
    const ip = "198.51.100.11";

    for (let i = 0; i < 130; i += 1) {
      const res = await request(app)
        .get("/api/mass-asset/missing.jpg")
        .set("X-Forwarded-For", ip);
      expect(res.status).not.toBe(429);
    }

    await request(app)
      .get("/api/mass-history")
      .set("X-Forwarded-For", ip)
      .expect(200);
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
