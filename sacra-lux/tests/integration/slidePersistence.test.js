const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const {
  createTempHome,
  loadReadingsFolder,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("current slide persistence", () => {
  let homeDir;

  async function boot() {
    jest.resetModules();
    return startIsolatedServer({ port: 0, homeDir });
  }

  beforeEach(() => {
    homeDir = createTempHome("sacra-lux-slide-persistence-");
  });

  test("restores the saved live slide during a Mass restart", async () => {
    const first = await boot();
    const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString().slice(0, 16);

    await request(first.app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "mass-first", type: "text", label: "First", phase: "mass", backgroundTheme: "dark" },
          { id: "mass-second", type: "text", label: "Second", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          "mass-first": { text: "First" },
          "mass-second": { text: "Second" }
        }
      })
      .expect(200);
    await request(first.app).post("/api/start-time").send({ time: startTime }).expect(200);

    const firstState = (await request(first.app).get("/api/state").expect(200)).body;
    const secondIndex = firstState.presentation.slides.findIndex((slide) => slide.organizerItemId === "mass-second");
    const client = createClient(first.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    client.emit("slide:goto", secondIndex);
    await new Promise((resolve) => setTimeout(resolve, 700));
    client.close();
    await first.stop();

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(state.currentSlideIndex).toBe(secondIndex);
      expect(state.presentation.slides[state.currentSlideIndex].organizerItemId).toBe("mass-second");
    } finally {
      await restarted.stop();
    }
  });

  test("uses the normal startup slide when the saved slide is older than four hours", async () => {
    const first = await boot();
    const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString().slice(0, 16);
    await request(first.app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "mass-first", type: "text", label: "First", phase: "mass", backgroundTheme: "dark" },
          { id: "mass-second", type: "text", label: "Second", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          "mass-first": { text: "First" },
          "mass-second": { text: "Second" }
        }
      })
      .expect(200);
    await request(first.app).post("/api/start-time").send({ time: startTime }).expect(200);
    const firstState = (await request(first.app).get("/api/state").expect(200)).body;
    const secondIndex = firstState.presentation.slides.findIndex((slide) => slide.organizerItemId === "mass-second");
    const client = createClient(first.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    client.emit("slide:goto", secondIndex);
    await new Promise((resolve) => setTimeout(resolve, 700));
    client.close();
    await first.stop();

    const fs = require("fs");
    const path = require("path");
    const sessionPath = path.join(homeDir, ".sacra-lux", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.currentSlideChangedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(state.currentSlideIndex).toBe(0);
      expect(state.presentation.slides[state.currentSlideIndex].organizerItemId).toBe("mass-first");
    } finally {
      await restarted.stop();
    }
  });

  test("restores the second reading item when both items use the same file", async () => {
    const first = await boot();
    const readingsDir = makeReadingsFolder(homeDir);
    await request(first.app).post("/api/screen-settings").send({ readingShowEnding: false }).expect(200);
    await loadReadingsFolder(first.app, readingsDir);
    await request(first.app).post("/api/organizer").send({
      sequence: [
        { id: "reading:Reading_I", type: "reading", sourceStem: "Reading_I", phase: "mass" },
        { id: "text:homily:1", type: "text", label: "Homily", phase: "mass" },
        { id: "text:announcement:1", type: "text", label: "Announcement", phase: "mass" },
        { id: "reading:Reading_I~2", type: "reading", sourceStem: "Reading_I", phase: "mass" }
      ],
      manualSlides: {
        "text:homily:1": { text: "Homily" },
        "text:announcement:1": { text: "Announcement" }
      }
    }).expect(200);

    const before = (await request(first.app).get("/api/state").expect(200)).body;
    const secondReadingIndex = before.presentation.slides.findIndex((slide) => (
      slide.organizerItemId === "reading:Reading_I~2"
    ));
    expect(secondReadingIndex).toBeGreaterThan(0);
    const client = createClient(first.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    client.emit("slide:goto", secondReadingIndex);
    await new Promise((resolve) => setTimeout(resolve, 700));
    client.close();
    await first.stop();

    const restarted = await boot();
    try {
      const after = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(after.currentSlideIndex).toBeGreaterThan(0);
      expect(after.presentation.slides[after.currentSlideIndex].organizerItemId).toBe("reading:Reading_I~2");
      expect(after.presentation.slides[after.currentSlideIndex].pageNumber)
        .toBe(before.presentation.slides[secondReadingIndex].pageNumber);
    } finally {
      await restarted.stop();
    }
  });

  test("restores the remaining countdown time after a restart", async () => {
    const first = await boot();
    await request(first.app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "countdown", type: "countdown", label: "Countdown", phase: "mass", backgroundTheme: "dark" },
          { id: "after", type: "text", label: "After", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          countdown: { countdownSec: 600 },
          after: { text: "After" }
        }
      })
      .expect(200);
    const firstState = (await request(first.app).get("/api/state").expect(200)).body;
    const countdownSlide = firstState.presentation.slides.find((slide) => slide.organizerItemId === "countdown");
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const fs = require("fs");
    const path = require("path");
    const sessionPath = path.join(homeDir, ".sacra-lux", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    const savedEndsAt = Date.now() + 300000;
    Object.assign(session, {
      currentSlideId: countdownSlide.id,
      currentSlideChangedAt: new Date().toISOString(),
      countdownEndsAt: savedEndsAt
    });
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(state.presentation.slides[state.currentSlideIndex].organizerItemId).toBe("countdown");
      expect(state.countdownEndsAt).toBeGreaterThanOrEqual(savedEndsAt - 2000);
      expect(state.countdownEndsAt).toBeLessThanOrEqual(savedEndsAt + 2000);
    } finally {
      await restarted.stop();
    }
  });

  test("advances past a countdown that expired during a restart", async () => {
    const first = await boot();
    await request(first.app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "countdown", type: "countdown", label: "Countdown", phase: "mass", backgroundTheme: "dark" },
          { id: "after", type: "text", label: "After", phase: "mass", backgroundTheme: "dark" }
        ],
        manualSlides: {
          countdown: { countdownSec: 600 },
          after: { text: "After" }
        }
      })
      .expect(200);
    const firstState = (await request(first.app).get("/api/state").expect(200)).body;
    const countdownSlide = firstState.presentation.slides.find((slide) => slide.organizerItemId === "countdown");
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const fs = require("fs");
    const path = require("path");
    const sessionPath = path.join(homeDir, ".sacra-lux", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    Object.assign(session, {
      currentSlideId: countdownSlide.id,
      currentSlideChangedAt: new Date().toISOString(),
      countdownEndsAt: Date.now() - 1000
    });
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(state.presentation.slides[state.currentSlideIndex].organizerItemId).toBe("after");
      expect(state.countdownEndsAt).toBeNull();
    } finally {
      await restarted.stop();
    }
  });
});
