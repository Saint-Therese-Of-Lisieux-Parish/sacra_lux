const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Clear the 600 ms persistence debounce so a seeded Mass's archive metadata has
// settled before the "before" snapshot is captured. Otherwise the pending save
// could rewrite archive metadata between the two reads and mask a real change.
const SAVE_SETTLE_MS = 700;

const futureStart = (daysAhead) => {
  const when = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
};

describe("mass creation rejects an unparseable start time", () => {
  let handle;
  let app;
  let state;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-bad-start-")
    });
    app = handle.app;
    ({ state } = require("../../src/state"));
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  beforeEach(() => {
    state.startPin = "";
    state.startPinHash = null;
  });

  async function snapshot() {
    const [stateRes, historyRes] = await Promise.all([
      request(app).get("/api/state").expect(200),
      request(app).get("/api/mass-history").expect(200)
    ]);
    return { state: stateRes.body, history: historyRes.body };
  }

  async function seedLiveMass(title) {
    await request(app)
      .post("/api/new-mass")
      .send({ title, startTime: "" })
      .expect(200);
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "welcome", type: "text", label: "Welcome", phase: "pre", backgroundTheme: "dark", durationSec: 30 },
          { id: "first-reading", type: "reading", label: "First Reading", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: { welcome: { text: "Welcome" } }
      })
      .expect(200);
    await wait(SAVE_SETTLE_MS);
  }

  const stateUpdates = (spy) =>
    spy.mock.calls.filter(([event]) => event === "state:update");

  function expectStateUnchanged(after, before) {
    const { serverTime: beforeServerTime, ...beforeState } = before;
    const { serverTime: afterServerTime, ...afterState } = after;
    expect(afterState).toEqual(beforeState);
    expect(afterServerTime).toBeGreaterThanOrEqual(beforeServerTime);
  }

  test("duplicate-mass returns 400 and leaves live state and archives untouched", async () => {
    await seedLiveMass("Duplicate Source");
    const before = await snapshot();
    const emitSpy = jest.spyOn(handle.io, "emit");

    const res = await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "Should Not Apply", startTime: "not-a-real-date" });

    expect(res.status).toBe(400);
    expect(stateUpdates(emitSpy)).toHaveLength(0);

    const after = await snapshot();
    expectStateUnchanged(after.state, before.state);
    expect(after.history).toEqual(before.history);

    emitSpy.mockRestore();
  });

  test("new-mass returns 400 and leaves live state and archives untouched", async () => {
    await seedLiveMass("New Mass Source");
    const before = await snapshot();
    const emitSpy = jest.spyOn(handle.io, "emit");

    const res = await request(app)
      .post("/api/new-mass")
      .send({ title: "Should Not Apply", startTime: "yesterday-ish" });

    expect(res.status).toBe(400);
    expect(stateUpdates(emitSpy)).toHaveLength(0);

    const after = await snapshot();
    expectStateUnchanged(after.state, before.state);
    expect(after.history).toEqual(before.history);

    emitSpy.mockRestore();
  });

  test("new-mass rejects the bad start time before contacting the lectionary", async () => {
    await seedLiveMass("Lectionary Source");
    const before = await snapshot();
    const originalFetch = global.fetch;
    global.fetch = jest.fn();

    try {
      const res = await request(app)
        .post("/api/new-mass")
        .send({ useLectionaryRss: true, startTime: "nonsense" });

      expect(res.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();

      const after = await snapshot();
      expectStateUnchanged(after.state, before.state);
      expect(after.history).toEqual(before.history);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("valid start times still succeed for both routes", async () => {
    await seedLiveMass("Valid Source");

    const duplicated = await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "Valid Copy", startTime: futureStart(3) })
      .expect(200);
    expect(duplicated.body.title).toBe("Valid Copy");

    const fresh = await request(app)
      .post("/api/new-mass")
      .send({ title: "Valid Fresh", startTime: futureStart(4) })
      .expect(200);
    expect(fresh.body.title).toBe("Valid Fresh");

    const stateRes = await request(app).get("/api/state").expect(200);
    expect(stateRes.body.presentation.title).toBe("Valid Fresh");
    expect(stateRes.body.massStartTime).toBeTruthy();
  });
});
