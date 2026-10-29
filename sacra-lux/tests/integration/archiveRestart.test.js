const fs = require("fs");
const path = require("path");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("Mass archive across restarts", () => {
  let homeDir;

  async function boot() {
    jest.resetModules();
    const handle = await startIsolatedServer({ port: 0, homeDir });
    return { handle, server: require("../../src/server") };
  }

  async function archiveIds(handle) {
    const response = await request(handle.app).get("/api/mass-history").expect(200);
    return { ids: response.body.archives.map((a) => a.id).sort(), active: response.body.activeArchiveId };
  }

  beforeEach(() => {
    homeDir = createTempHome("sacra-lux-archive-restart-");
  });

  test("three restarts with a save after each keep one archive active", async () => {
    const first = await boot();
    await request(first.handle.app).post("/api/new-mass").send({ title: "Sunday Mass", startTime: "2026-04-01T09:00" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.handle.stop();

    for (let run = 0; run < 3; run += 1) {
      const { handle, server } = await boot();
      expect(await archiveIds(handle)).toEqual({ ids: ["Sunday-Mass"], active: "Sunday-Mass" });
      server.saveCurrentMass();
      expect(await archiveIds(handle)).toEqual({ ids: ["Sunday-Mass"], active: "Sunday-Mass" });
      await handle.stop();
    }
  });

  test("a saved archive ID that is not on disk gives one new archive", async () => {
    const first = await boot();
    await request(first.handle.app).post("/api/new-mass").send({ title: "Sunday Mass", startTime: "2026-04-01T09:00" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.handle.stop();

    const sessionPath = path.join(homeDir, ".sacra-lux", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.activeMassArchiveId = "Missing-Archive";
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");
    fs.rmSync(path.join(homeDir, ".sacra-lux", "mass_history", "Sunday-Mass"), { recursive: true, force: true });

    const restarted = await boot();
    const { handle } = restarted;
    expect((await archiveIds(handle)).active).toBeNull();
    restarted.server.saveCurrentMass();
    expect((await archiveIds(handle)).ids).toHaveLength(1);
    await handle.stop();
  });

  test("a recent saved pre-Mass loop resumes after restart", async () => {
    const first = await boot();
    const { state } = require("../../src/state");
    const { saveSession } = require("../../src/persistence");
    await request(first.handle.app).post("/api/new-mass").send({ title: "Pre loop", startTime: "" }).expect(200);
    await request(first.handle.app).post("/api/organizer").send({
      sequence: [
        { id: "pre-a", type: "text", label: "Pre A", phase: "pre", durationSec: 1 },
        { id: "pre-b", type: "text", label: "Pre B", phase: "pre", durationSec: 1 },
        { id: "mass", type: "text", label: "Mass", phase: "mass", durationSec: 10 }
      ],
      manualSlides: { "pre-a": { text: "A" }, "pre-b": { text: "B" }, mass: { text: "Mass" } }
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    state.currentSlideIndex = 0;
    state.currentSlideId = null;
    state.preMassRunning = true;
    saveSession(state);
    await first.handle.stop();

    const restarted = await boot();
    expect((await request(restarted.handle.app).get("/api/state")).body.preMassRunning).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await request(restarted.handle.app).get("/api/state")).body.currentSlideIndex).toBe(1);
    await restarted.handle.stop();
  });

  test("an old saved phase loop does not resume after restart", async () => {
    const first = await boot();
    const { state } = require("../../src/state");
    const { saveSession } = require("../../src/persistence");
    await request(first.handle.app).post("/api/new-mass").send({ title: "Old loop", startTime: "" }).expect(200);
    await request(first.handle.app).post("/api/organizer").send({
      sequence: [{ id: "pre", type: "text", label: "Pre", phase: "pre", durationSec: 1 }],
      manualSlides: { pre: { text: "Pre" } }
    }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    state.currentSlideIndex = 0;
    state.currentSlideId = null;
    state.preMassRunning = true;
    saveSession(state);
    const sessionPath = path.join(homeDir, ".sacra-lux", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.savedAt = new Date(Date.now() - (5 * 60 * 60 * 1000)).toISOString();
    fs.writeFileSync(sessionPath, JSON.stringify(session), "utf8");
    await first.handle.stop();

    const restarted = await boot();
    expect((await request(restarted.handle.app).get("/api/state")).body.preMassRunning).toBe(false);
    await restarted.handle.stop();
  });
});
