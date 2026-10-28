const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const {
  createTempHome,
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
});
