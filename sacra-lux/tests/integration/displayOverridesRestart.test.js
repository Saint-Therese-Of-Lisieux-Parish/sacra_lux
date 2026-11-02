const fs = require("fs");
const path = require("path");
const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

describe("display overrides across restarts", () => {
  let homeDir;

  beforeEach(() => {
    homeDir = createTempHome("sacra-lux-display-overrides-");
  });

  async function boot() {
    jest.resetModules();
    const handle = await startIsolatedServer({ port: 0, homeDir });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { handle, server: require("../../src/server") };
  }

  async function createMass(handle) {
    await request(handle.app).post("/api/new-mass").send({ title: "Display test", startTime: "" }).expect(200);
    await request(handle.app).post("/api/organizer").send({
      sequence: [
        { id: "intro", type: "text", label: "Intro", phase: "mass" },
        { id: "hold", type: "interstitial", label: "Hold", phase: "mass" },
        { id: "gospel", type: "text", label: "Gospel", phase: "mass" }
      ],
      manualSlides: {
        intro: { text: "Intro" },
        hold: { text: "Hold" },
        gospel: { text: "Gospel" }
      }
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  test("restores a recent black screen", async () => {
    const first = await boot();
    await createMass(first.handle);
    const { state } = require("../../src/state");
    const { saveSession } = require("../../src/persistence");
    state.isBlack = true;
    saveSession(state);
    expect(JSON.parse(fs.readFileSync(path.join(homeDir, ".sacra-lux", "session.json"))).isBlack).toBe(true);
    await first.handle.stop();
    expect(JSON.parse(fs.readFileSync(path.join(homeDir, ".sacra-lux", "session.json"))).isBlack).toBe(true);

    const restarted = await boot();
    expect((await request(restarted.handle.app).get("/api/state")).body.isBlack).toBe(true);
    await restarted.handle.stop();
  });

  test("restores a recent interstitial hold and its return slide", async () => {
    const first = await boot();
    await createMass(first.handle);
    const { state } = require("../../src/state");
    const { saveSession } = require("../../src/persistence");
    state.currentSlideIndex = 2;
    state.currentSlideId = "gospel";
    state.interstitialHoldActive = true;
    state.interstitialHoldSlideIndex = 1;
    state.interstitialHoldReturnSlideIndex = 2;
    state.interstitialHoldResumeState = { preMassRunning: false, gatheringRunning: false, postMassRunning: false };
    saveSession(state);
    await first.handle.stop();

    const restarted = await boot();
    const restored = (await request(restarted.handle.app).get("/api/state")).body;
    const { state: restartedState } = require("../../src/state");
    expect(restored.interstitialHoldActive).toBe(true);
    expect(restored.presentation.slides[restored.interstitialHoldSlideIndex].type).toBe("interstitial");
    expect(restartedState.interstitialHoldReturnSlideIndex).toBe(2);
    const client = createClient(restarted.handle.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
    const released = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out while releasing the restored hold.")), 3000);
      client.on("state:update", (next) => {
        if (next.interstitialHoldActive) return;
        clearTimeout(timeout);
        resolve(next);
      });
    });
    client.emit("screen:interstitial-hold");
    expect((await released).currentSlideIndex).toBe(2);
    client.disconnect();
    await restarted.handle.stop();
  });

  test("does not restore display overrides from an old session", async () => {
    const first = await boot();
    await createMass(first.handle);
    const { state } = require("../../src/state");
    const { saveSession, getSessionFilePath } = require("../../src/persistence");
    state.isBlack = true;
    saveSession(state);
    const sessionPath = getSessionFilePath();
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.savedAt = new Date(Date.now() - (5 * 60 * 60 * 1000)).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");
    await first.handle.stop();

    const restarted = await boot();
    const restored = (await request(restarted.handle.app).get("/api/state")).body;
    expect(restored.isBlack).toBe(false);
    expect(restored.interstitialHoldActive).toBe(false);
    await restarted.handle.stop();
  });
});
