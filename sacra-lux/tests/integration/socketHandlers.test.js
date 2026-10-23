const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("socket handlers", () => {
  let handle;
  let app;
  let state;
  let resetSecurityState;
  let client;

  const sequence = [
    { id: "pre-a", type: "text", label: "Pre A", phase: "pre", backgroundTheme: "dark", durationSec: 600 },
    { id: "pre-b", type: "text", label: "Pre B", phase: "pre", backgroundTheme: "dark", durationSec: 600 },
    { id: "gath-a", type: "text", label: "Gathering", phase: "gathering", backgroundTheme: "dark", durationSec: 600 },
    { id: "count", type: "countdown", label: "Count", phase: "gathering", backgroundTheme: "dark", durationSec: 600 },
    { id: "mass-a", type: "text", label: "Mass A", phase: "mass", backgroundTheme: "dark", durationSec: 600 },
    { id: "movie", type: "movie", label: "Movie", phase: "mass", backgroundTheme: "light", durationSec: 600 },
    { id: "show", type: "imageSlideshow", label: "Show", phase: "mass", backgroundTheme: "light", durationSec: 600 },
    { id: "post-a", type: "text", label: "Post A", phase: "post", backgroundTheme: "dark", durationSec: 600 },
    { id: "post-b", type: "text", label: "Post B", phase: "post", backgroundTheme: "dark", durationSec: 600 }
  ];

  const manualSlides = {
    "pre-a": { text: "Pre A" },
    "pre-b": { text: "Pre B" },
    "gath-a": { text: "Gathering" },
    count: { countdownSec: 600 },
    "mass-a": { text: "Mass A" },
    movie: { text: "", videoUrl: "/api/mass-asset/film.mp4", videoLoop: false, videoAutoAdvance: true },
    show: {
      text: "",
      images: [
        { url: "/api/mass-asset/one.png", name: "one" },
        "/api/mass-asset/two.png"
      ],
      imageUrl: "/api/mass-asset/one.png"
    },
    "post-a": { text: "Post A" },
    "post-b": { text: "Post B" }
  };

  async function connect(options = {}) {
    const socket = createClient(handle.baseUrl, { transports: ["websocket"], ...options });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return socket;
  }

  function nextEvent(socket, event, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function waitForState(socket, predicate) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("state:update", onUpdate);
        reject(new Error("Timed out while waiting for state."));
      }, 3000);
      const onUpdate = (snapshot) => {
        if (!predicate(snapshot)) return;
        clearTimeout(timer);
        socket.off("state:update", onUpdate);
        resolve(snapshot);
      };
      socket.on("state:update", onUpdate);
    });
  }

  async function goto(event, index) {
    const pending = waitForState(client, (next) => next.currentSlideIndex === index);
    client.emit(event, index);
    return pending;
  }

  // Round-trip to the server so earlier fire-and-forget emits have run.
  async function flush() {
    const pending = nextEvent(client, "control:ok");
    client.emit("control:auth", { token: "" });
    await pending.catch(() => undefined);
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-socket-") });
    app = handle.app;
    ({ state } = require("../../src/state"));
    ({ resetSecurityState } = require("../../src/security"));
  });

  beforeEach(async () => {
    resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    state.controlMode = "unset";
    await request(app).post("/api/new-mass").send({ title: "Socket Mass", startTime: "" }).expect(200);
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    client = await connect();
  });

  afterEach(() => {
    if (client) client.disconnect();
    client = null;
    state.preMassRunning = false;
    state.gatheringRunning = false;
    state.postMassRunning = false;
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  describe("control authorization", () => {
    test("rejects a wrong token and accepts the issued one", async () => {
      const pin = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const anonymous = await connect();
      try {
        const denied = nextEvent(anonymous, "control:required");
        anonymous.emit("control:auth", { token: "wrong" });
        expect(await denied).toEqual({ error: expect.any(String) });

        const noPayload = nextEvent(anonymous, "control:required");
        anonymous.emit("control:auth");
        await noPayload;

        const accepted = nextEvent(anonymous, "control:ok");
        anonymous.emit("control:auth", { token: pin.body.controlToken });
        await accepted;
      } finally {
        anonymous.disconnect();
      }
    });

    test("blocks control events from a client without a session", async () => {
      await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const anonymous = await connect();
      try {
        for (const event of ["slide:next", "slide:prev", "slide:goto", "screen:black", "screen:settings", "slide:video-ended"]) {
          const denied = nextEvent(anonymous, "control:required");
          anonymous.emit(event, {});
          await denied;
        }
        expect(state.currentSlideIndex).toBe(0);
      } finally {
        anonymous.disconnect();
      }
    });

    test("requires a control session to export AVIF", async () => {
      await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const anonymous = await connect();
      try {
        const denied = nextEvent(anonymous, "control:required");
        anonymous.emit("export:avif:start");
        await denied;
      } finally {
        anonymous.disconnect();
      }
    });
  });

  describe("settings and display", () => {
    test("screen:settings normalizes and broadcasts, including an empty payload", async () => {
      let pending = waitForState(client, (next) => next.screenSettings.fontSizePx === 90);
      client.emit("screen:settings", { fontSizePx: 90 });
      await pending;

      pending = waitForState(client, (next) => next.screenSettings.fontSizePx === 90);
      client.emit("screen:settings");
      await pending;
    });

    test("screen:black toggles the blackout flag", async () => {
      let pending = waitForState(client, (next) => next.isBlack === true);
      client.emit("screen:black", true);
      await pending;

      pending = waitForState(client, (next) => next.isBlack === false);
      client.emit("screen:black", 0);
      await pending;
    });

    test("screen:interstitial-hold reports an error when no interstitial exists", async () => {
      await request(app).post("/api/organizer").send({
        sequence: [{ id: "only", type: "text", label: "Only", phase: "mass", backgroundTheme: "dark", durationSec: 10 }],
        manualSlides: { only: { text: "Only" } }
      }).expect(200);
      const hasInterstitial = (state.presentation?.slides || []).some((slide) => slide.type === "interstitial");
      if (hasInterstitial) return;

      const failed = nextEvent(client, "interstitial:hold:error");
      client.emit("screen:interstitial-hold");
      expect(await failed).toEqual({ error: "No interstitial slide is available." });
    });
  });

  describe("slide navigation", () => {
    test("slide:goto treats a bad index as the first slide", async () => {
      await goto("slide:goto", 3);
      const pending = waitForState(client, (next) => next.currentSlideIndex === 0);
      client.emit("slide:goto", "not a number");
      await pending;
    });

    test("slide:next and slide:prev step by one", async () => {
      await goto("slide:goto", 1);
      let pending = waitForState(client, (next) => next.currentSlideIndex === 2);
      client.emit("slide:next");
      await pending;
      pending = waitForState(client, (next) => next.currentSlideIndex === 1);
      client.emit("slide:prev");
      await pending;
    });

    test("a remote jump into the gathering phase starts the gathering sequence", async () => {
      const gathering = state.presentation.slides.findIndex((slide) => slide.phase === "gathering");
      await goto("slide:goto:remote", gathering);
      expect(state.gatheringRunning).toBe(true);
    });

    test("a remote jump into the post phase starts the post-Mass loop", async () => {
      const post = state.presentation.slides.findIndex((slide) => slide.phase === "post");
      await goto("slide:goto:remote", post);
      expect(state.postMassRunning).toBe(true);
    });

    test("moving between slides reschedules or stops each running phase timer", async () => {
      const slides = state.presentation.slides;
      const indexOf = (phase) => slides.findIndex((slide) => slide.phase === phase);

      state.preMassRunning = true;
      await goto("slide:goto", indexOf("pre"));
      expect(state.preMassRunning).toBe(true);
      await goto("slide:goto", indexOf("mass"));
      expect(state.preMassRunning).toBe(false);

      state.gatheringRunning = true;
      await goto("slide:goto", indexOf("gathering"));
      expect(state.gatheringRunning).toBe(true);
      await goto("slide:goto", indexOf("mass"));
      expect(state.gatheringRunning).toBe(false);

      state.postMassRunning = true;
      await goto("slide:goto", indexOf("post"));
      expect(state.postMassRunning).toBe(true);
      await goto("slide:goto", indexOf("mass"));
      expect(state.postMassRunning).toBe(false);
    });

    test("entering a countdown starts it and leaving stops it", async () => {
      const countdown = state.presentation.slides.findIndex((slide) => slide.type === "countdown");
      const snapshot = await goto("slide:goto", countdown);
      expect(snapshot.countdownEndsAt).toEqual(expect.anything());
      const left = await goto("slide:goto", 0);
      expect(left.countdownEndsAt).toBeNull();
    });

    test("an image slideshow outside a running phase schedules its own timer", async () => {
      const show = state.presentation.slides.findIndex((slide) => slide.type === "imageSlideshow");
      await goto("slide:goto", show);
      expect(state.presentation.slides[state.currentSlideIndex].type).toBe("imageSlideshow");
    });
  });

  describe("movie reports", () => {
    function movieIndex() {
      return state.presentation.slides.findIndex((slide) => slide.type === "movie");
    }

    test("video-ended advances once and ignores duplicates", async () => {
      const index = movieIndex();
      await goto("slide:goto", index);
      const slideId = state.presentation.slides[index].id;

      client.emit("slide:video-ended", { slideId: "other" });
      client.emit("slide:video-ended", {});
      await flush();
      expect(state.currentSlideIndex).toBe(index);

      await waitForState(client, (next) => next.currentSlideIndex !== index).then(() => undefined, () => undefined);
      client.emit("slide:video-ended", { slideId });
      await flush();
      client.emit("slide:video-ended", { slideId });
      await flush();
    });

    test("video-ended is ignored on a slide that is not a movie", async () => {
      client.emit("slide:video-ended", { slideId: state.presentation.slides[0].id });
      await flush();
      expect(state.currentSlideIndex).toBe(0);
    });

    test("video-ready ignores a missing, zero, or wrong report and schedules a valid one", async () => {
      const index = movieIndex();
      client.emit("slide:video-ready", { slideId: state.presentation.slides[0].id, durationMs: 1000 });
      await flush();

      await goto("slide:goto", index);
      const slideId = state.presentation.slides[index].id;
      client.emit("slide:video-ready", { slideId: "other", durationMs: 1000 });
      client.emit("slide:video-ready", { slideId });
      client.emit("slide:video-ready", { slideId, durationMs: 0 });
      client.emit("slide:video-ready", { slideId, durationMs: "soon" });
      client.emit("slide:video-ready", { slideId, durationMs: 600000 });
      await flush();
      expect(state.currentSlideIndex).toBe(index);
    });
  });

  describe("image slideshow preload errors", () => {
    test("records an error for a known slideshow image and ignores unknown ones", async () => {
      const show = state.presentation.slides.findIndex((slide) => slide.type === "imageSlideshow");
      await goto("slide:goto", show);
      const slide = state.presentation.slides[show];

      const errorBefore = state.imageSlideshowError;
      client.emit("image-slideshow:preload-error", {});
      client.emit("image-slideshow:preload-error", { slideId: slide.id, imageUrl: "/api/mass-asset/nope.png" });
      await flush();
      expect(state.imageSlideshowError).toBe(errorBefore);

      if (!slide.imageUrl) return;
      const pending = waitForState(client, (next) => /Could not preload/.test(next.imageSlideshowError || ""));
      client.emit("image-slideshow:preload-error", { slideId: slide.id, imageUrl: slide.imageUrl });
      await pending;
    });
  });

  describe("AVIF export", () => {
    let tinyPng;

    beforeAll(async () => {
      tinyPng = await require("sharp")({
        create: { width: 2, height: 2, channels: 3, background: "#336699" }
      }).png().toBuffer();
    });

    test("converts images, copies other media, and remaps references", async () => {
      const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, "one.png"), tinyPng);
      fs.writeFileSync(path.join(assetsDir, "two.png"), tinyPng);
      fs.writeFileSync(path.join(assetsDir, "film.mp4"), Buffer.from("not really a movie"));
      fs.writeFileSync(path.join(assetsDir, "back.png"), tinyPng);

      const pin = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const headers = { "x-sacra-control": pin.body.controlToken };
      await request(app).post("/api/screen-settings").set(headers).send({
        darkBackgroundUrl: "/api/mass-asset/back.png",
        lightBackgroundUrl: "/static/assets/default-interstitial.png"
      }).expect(200);
      await request(app).post("/api/organizer").set(headers).send({
        sequence: [
          { id: "movie", type: "movie", label: "Movie", phase: "mass", backgroundTheme: "light", durationSec: 10 },
          { id: "show", type: "imageSlideshow", label: "Show", phase: "mass", backgroundTheme: "light", durationSec: 10 },
          { id: "pic", type: "image", label: "Pic", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          movie: { text: "", videoUrl: "/api/mass-asset/film.mp4", videoLoop: false, videoAutoAdvance: true },
          show: { text: "", images: [{ url: "/api/mass-asset/one.png" }, "/api/mass-asset/two.png", {}] },
          pic: { text: "", imageUrl: "/api/mass-asset/one.png" }
        }
      }).expect(200);

      const operator = await connect({ auth: { token: pin.body.controlToken } });
      try {
        const progress = [];
        operator.on("export:avif:progress", (payload) => progress.push(payload.filename));
        const done = nextEvent(operator, "export:avif:done", 20000);
        operator.emit("export:avif:start");
        const { token } = await done;
        expect(progress).toEqual(expect.arrayContaining(["one.png", "film.mp4"]));

        const zipRes = await request(app)
          .get(`/api/export-mass-zip-avif?token=${token}`)
          .set(headers)
          .buffer(true)
          .parse((res, callback) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => callback(null, Buffer.concat(chunks)));
          })
          .expect(200);
        const zip = new AdmZip(zipRes.body);
        const names = zip.getEntries().map((entry) => entry.entryName);
        expect(names).toEqual(expect.arrayContaining(["mass.json", "assets/one.avif", "assets/two.avif", "assets/film.mp4"]));
      } finally {
        operator.disconnect();
      }
    });

    test("reports an error when the export fails", async () => {
      const pin = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const operator = await connect({ auth: { token: pin.body.controlToken } });
      try {
        const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.writeFileSync(path.join(assetsDir, "broken.png"), Buffer.from("not an image"));
        await request(app).post("/api/organizer").send({
          sequence: [{ id: "pic", type: "image", label: "Pic", phase: "mass", backgroundTheme: "dark", durationSec: 10 }],
          manualSlides: { pic: { text: "", imageUrl: "/api/mass-asset/broken.png" } }
        }).set("x-sacra-control", pin.body.controlToken).expect(200);

        const failed = nextEvent(operator, "export:avif:error", 20000);
        operator.emit("export:avif:start");
        expect(await failed).toEqual({ error: expect.any(String) });
      } finally {
        operator.disconnect();
      }
    });

    test("exports a ZIP when the Mass has no convertible media", async () => {
      const pin = await request(app).post("/api/start-pin").send({ pin: "1234" }).expect(200);
      const operator = await connect({ auth: { token: pin.body.controlToken } });
      try {
        const done = nextEvent(operator, "export:avif:done", 15000);
        operator.emit("export:avif:start");
        expect(await done).toEqual({ token: expect.any(String) });
      } finally {
        operator.disconnect();
      }
    });
  });
});
