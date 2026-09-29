const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

// The wall-clock tests need controlled time. Keep I/O and microtask scheduling
// real so supertest's HTTP round-trips still resolve while Date and setTimeout
// are faked.
const FAKE_TIMER_EXCLUSIONS = [
  "nextTick",
  "queueMicrotask",
  "setImmediate",
  "clearImmediate",
  "hrtime",
  "performance"
];

describe("mass start from the wall clock", () => {
  let handle;
  let app;
  let resetSecurityState;
  let state;

  const gatheringSequence = [
    { id: "g-one", type: "text", label: "Gathering One", phase: "gathering", backgroundTheme: "dark", durationSec: 10 },
    { id: "g-two", type: "text", label: "Gathering Two", phase: "gathering", backgroundTheme: "dark", durationSec: 10 },
    { id: "g-three", type: "text", label: "Gathering Three", phase: "gathering", backgroundTheme: "dark", durationSec: 10 },
    { id: "m-first", type: "text", label: "Mass First", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
    { id: "m-second", type: "text", label: "Mass Second", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
  ];

  const gatheringManualSlides = {
    "g-one": { text: "Gathering One" },
    "g-two": { text: "Gathering Two" },
    "g-three": { text: "Gathering Three" },
    "m-first": { text: "Mass First" },
    "m-second": { text: "Mass Second" }
  };

  const currentPhase = (body) => body.presentation.slides[body.currentSlideIndex]?.phase;
  const indexOfPhase = (body, phase) => body.presentation.slides.findIndex((slide) => slide.phase === phase);

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-clock-") });
    app = handle.app;
    ({ resetSecurityState } = require("../../src/security"));
    ({ state } = require("../../src/state"));
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  beforeEach(() => {
    resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Clear any start time left by a previous test so the organizer call below
  // cannot re-arm a stale wall-clock timer.
  async function seedGatheringAndMass() {
    await request(app).post("/api/start-time").send({ time: "" }).expect(200);
    await request(app)
      .post("/api/organizer")
      .send({ sequence: gatheringSequence, manualSlides: gatheringManualSlides })
      .expect(200);
  }

  test("opening inside the gathering window starts gathering immediately", async () => {
    // 30 s of gathering remain but only 10 s until Mass, so the lead-in is past.
    jest.setSystemTime(new Date("2026-05-03T09:59:50"));
    await seedGatheringAndMass();

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.preMassRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("gathering");
    expect(res.body.currentSlideIndex).toBe(indexOfPhase(res.body, "gathering"));
  });

  test("gathering overrunning the clock cuts over to the first Mass slide at Mass time", async () => {
    // Gathering is 30 s long but only 10 s remain, so it overruns the clock.
    jest.setSystemTime(new Date("2026-05-03T09:59:50"));
    await seedGatheringAndMass();

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(currentPhase(res.body)).toBe("gathering");

    jest.advanceTimersByTime(10 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("mass");
    expect(res.body.currentSlideIndex).toBe(indexOfPhase(res.body, "mass"));
  });

  test("opening after Mass time shows the first Mass slide", async () => {
    jest.setSystemTime(new Date("2026-05-03T10:05:00"));
    await seedGatheringAndMass();

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("mass");
    expect(res.body.currentSlideIndex).toBe(indexOfPhase(res.body, "mass"));
  });

  test("a gathering countdown does not skip the first Mass slide after cutover", async () => {
    // The organizer duration is 30s, which is what the lead-in uses. The
    // countdown itself runs 60s, so it is still going when Mass time arrives.
    jest.setSystemTime(new Date("2026-05-03T09:59:30"));
    await request(app).post("/api/start-time").send({ time: "" }).expect(200);
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "g-count", type: "countdown", label: "Gathering countdown", phase: "gathering", backgroundTheme: "dark", durationSec: 30 },
          { id: "m-first", type: "text", label: "Mass Title", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
          { id: "m-second", type: "text", label: "Opening Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
        ],
        manualSlides: {
          "g-count": { countdownSec: 60 },
          "m-first": { text: "Mass Title" },
          "m-second": { text: "Opening Hymn" }
        }
      })
      .expect(200);

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.presentation.slides[res.body.currentSlideIndex].type).toBe("countdown");

    jest.advanceTimersByTime(30 * 1000);

    res = await request(app).get("/api/state").expect(200);
    const massIndex = indexOfPhase(res.body, "mass");
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.countdownEndsAt).toBeNull();
    expect(res.body.currentSlideIndex).toBe(massIndex);
    expect(res.body.presentation.slides[massIndex].title).toBe("Mass Title");

    // The countdown's remaining 30s must not advance off the Mass title.
    jest.advanceTimersByTime(30 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(massIndex);
    expect(res.body.presentation.slides[res.body.currentSlideIndex].phase).toBe("mass");
    expect(res.body.countdownEndsAt).toBeNull();
  });

  test("saving the organizer during Mass does not rewind the projector", async () => {
    jest.setSystemTime(new Date("2026-05-03T10:20:00"));
    await seedGatheringAndMass();

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    // Operator has moved to the second Mass slide.
    state.currentSlideIndex = 4;
    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(4);

    await request(app)
      .post("/api/organizer")
      .send({ sequence: gatheringSequence, manualSlides: gatheringManualSlides })
      .expect(200);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(4);
  });
});
