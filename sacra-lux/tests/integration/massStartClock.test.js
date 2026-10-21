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
    // Tests share one server. A later case must not inherit a Mass slide the
    // previous case left showing, or catch-up will treat the Mass as started.
    state.currentSlideIndex = 0;
    state.preMassRunning = false;
    state.gatheringRunning = false;
    state.postMassRunning = false;
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

  // Wall-clock strings without an offset are local time. Across a clock change
  // the real wait is not the difference of the two clock readings. Compute the
  // wait from Date, so the test holds in every TZ, with or without DST.
  test.each([
    ["US spring forward", "2026-03-08T01:59:50", "2026-03-08T03:00:00"],
    ["US fall back", "2026-11-01T00:59:50", "2026-11-01T02:00:00"],
    ["EU spring forward", "2026-03-29T00:59:50", "2026-03-29T02:00:00"],
    ["EU fall back", "2026-10-25T00:59:50", "2026-10-25T02:00:00"]
  ])("%s: cuts over to Mass when the local start time arrives", async (_label, nowLocal, startLocal) => {
    const now = new Date(nowLocal);
    const waitMs = new Date(startLocal).getTime() - now.getTime();
    // The wait must be long enough to observe both sides of the cutover.
    expect(waitMs).toBeGreaterThan(2000);

    jest.setSystemTime(now);
    await seedGatheringAndMass();
    await request(app)
      .post("/api/start-time")
      .send({ time: startLocal })
      .expect(200);

    jest.advanceTimersByTime(waitMs - 1000);
    let res = await request(app).get("/api/state").expect(200);
    expect(currentPhase(res.body)).not.toBe("mass");

    jest.advanceTimersByTime(1000);
    res = await request(app).get("/api/state").expect(200);
    expect(currentPhase(res.body)).toBe("mass");
  });

  test("cutover keeps the Mass slide an operator already reached", async () => {
    // One minute before Mass. Gathering is 30s, so its lead-in is 9:59:30.
    jest.setSystemTime(new Date("2026-05-03T09:59:00"));
    await seedGatheringAndMass();

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    const massSlides = res.body.presentation.slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => slide.phase === "mass");
    const secondMassIndex = massSlides[1].index;
    expect(massSlides[1].slide.title).toBe("Mass Second");
    state.currentSlideIndex = secondMassIndex;

    jest.advanceTimersByTime(30 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.currentSlideIndex).toBe(secondMassIndex);

    jest.advanceTimersByTime(30 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.preMassRunning).toBe(false);
    expect(res.body.currentSlideIndex).toBe(secondMassIndex);
    expect(res.body.presentation.slides[res.body.currentSlideIndex].title).toBe("Mass Second");
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

  test("a new Mass arms gathering from its own slides", async () => {
    // Default gathering is one 30s countdown. Ten minutes out, the lead-in is
    // 30s before Mass, not at Mass time.
    jest.setSystemTime(new Date("2026-05-03T09:50:00"));

    await request(app)
      .post("/api/new-mass")
      .send({ title: "Clock Mass", startTime: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    const gatheringIndex = indexOfPhase(res.body, "gathering");
    const massIndex = indexOfPhase(res.body, "mass");
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.currentSlideIndex).toBe(0);
    expect(res.body.presentation.slides[gatheringIndex].organizerItemId).toBe("gathering-countdown");

    jest.advanceTimersByTime((9 * 60 + 30) * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.currentSlideIndex).toBe(gatheringIndex);

    jest.advanceTimersByTime(30 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.currentSlideIndex).toBe(massIndex);
    expect(res.body.presentation.slides[massIndex].organizerItemId).toBe("mass-title");
  });

  test("loading an archive after Mass time stays on the first Mass slide", async () => {
    jest.setSystemTime(new Date("2026-05-03T09:00:00"));
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Past Mass", startTime: "2026-05-03T10:00:00" })
      .expect(200);
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Placeholder Past", startTime: "" })
      .expect(200);

    jest.setSystemTime(new Date("2026-05-03T10:05:00"));
    await request(app).post("/api/mass-history/Past-Mass/load").expect(200);

    let res = await request(app).get("/api/state").expect(200);
    const massIndex = indexOfPhase(res.body, "mass");
    expect(res.body.gatheringRunning).toBe(false);
    expect(res.body.currentSlideIndex).toBe(massIndex);

    jest.advanceTimersByTime(60 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(massIndex);
    expect(currentPhase(res.body)).toBe("mass");
  });

  test("loading an archive inside the gathering window starts gathering", async () => {
    jest.setSystemTime(new Date("2026-05-03T09:00:00"));
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Window Mass", startTime: "2026-05-03T10:00:00" })
      .expect(200);
    await request(app)
      .post("/api/new-mass")
      .send({ title: "Placeholder Window", startTime: "" })
      .expect(200);

    // 30s of gathering, 10s left until Mass.
    jest.setSystemTime(new Date("2026-05-03T09:59:50"));
    await request(app).post("/api/mass-history/Window-Mass/load").expect(200);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(currentPhase(res.body)).toBe("gathering");
    expect(res.body.currentSlideIndex).toBe(indexOfPhase(res.body, "gathering"));
  });

  test("duplicating a Mass inside the gathering window keeps gathering running", async () => {
    jest.setSystemTime(new Date("2026-05-03T09:00:00"));
    await request(app)
      .post("/api/new-mass")
      .send({ title: "To Copy", startTime: "2026-05-03T10:00:00" })
      .expect(200);

    jest.setSystemTime(new Date("2026-05-03T09:59:50"));
    await request(app)
      .post("/api/duplicate-mass")
      .send({ title: "Copied Window", startTime: "2026-05-03T10:00:00" })
      .expect(200);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.preMassRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("gathering");
    expect(res.body.currentSlideIndex).toBe(indexOfPhase(res.body, "gathering"));
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

  test("setting the start time during pre-Mass starts gathering when the lead-in has passed", async () => {
    // Mass is four minutes away and gathering is ten minutes, so the lead-in is past.
    jest.setSystemTime(new Date("2026-05-03T09:56:00"));
    const sequence = [
      { id: "p-welcome", type: "text", label: "Welcome", phase: "pre", backgroundTheme: "dark", durationSec: 600 },
      { id: "g-long", type: "text", label: "Gathering Long", phase: "gathering", backgroundTheme: "dark", durationSec: 600 },
      { id: "m-first", type: "text", label: "Mass First", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
    ];
    const manualSlides = {
      "p-welcome": { text: "Welcome" },
      "g-long": { text: "Gathering Long" },
      "m-first": { text: "Mass First" }
    };

    await request(app).post("/api/start-time").send({ time: "" }).expect(200);
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    await request(app).post("/api/pre-mass/start").expect(200);

    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.preMassRunning).toBe(true);

    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.preMassRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("gathering");
    expect(res.body.presentation.slides[res.body.currentSlideIndex].title).toBe("Gathering Long");
  });

  test("an organizer save that pushes the lead-in into the past starts gathering", async () => {
    // Eight minutes until Mass. Five minutes of gathering still lies ahead.
    jest.setSystemTime(new Date("2026-05-03T09:52:00"));
    const massSlide = { id: "m-first", type: "text", label: "Mass First", phase: "mass", backgroundTheme: "dark", durationSec: 10 };
    const shortGathering = { id: "g-short", type: "text", label: "Gathering Short", phase: "gathering", backgroundTheme: "dark", durationSec: 300 };
    const longGathering = { id: "g-long", type: "text", label: "Gathering Long", phase: "gathering", backgroundTheme: "dark", durationSec: 720 };

    await request(app).post("/api/start-time").send({ time: "" }).expect(200);
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [shortGathering, massSlide],
        manualSlides: { "g-short": { text: "Gathering Short" }, "m-first": { text: "Mass First" } }
      })
      .expect(200);
    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(false);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [longGathering, massSlide],
        manualSlides: { "g-long": { text: "Gathering Long" }, "m-first": { text: "Mass First" } }
      })
      .expect(200);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.preMassRunning).toBe(false);
    expect(currentPhase(res.body)).toBe("gathering");
    expect(res.body.presentation.slides[res.body.currentSlideIndex].title).toBe("Gathering Long");
  });

  test("saving the organizer leaves a gathering sequence where it is", async () => {
    jest.setSystemTime(new Date("2026-05-03T09:59:50"));
    await seedGatheringAndMass();
    await request(app)
      .post("/api/start-time")
      .send({ time: "2026-05-03T10:00:00" })
      .expect(200);

    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    const gatheringSlides = res.body.presentation.slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => slide.phase === "gathering");
    const secondGatheringIndex = gatheringSlides[1].index;
    expect(gatheringSlides[1].slide.title).toBe("Gathering Two");
    state.currentSlideIndex = secondGatheringIndex;

    await request(app)
      .post("/api/organizer")
      .send({ sequence: gatheringSequence, manualSlides: gatheringManualSlides })
      .expect(200);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.gatheringRunning).toBe(true);
    expect(res.body.currentSlideIndex).toBe(secondGatheringIndex);
    expect(res.body.presentation.slides[res.body.currentSlideIndex].title).toBe("Gathering Two");
  });

  test("a start time more than 24 days away waits instead of starting now", async () => {
    // A delay above setTimeout's 32-bit ceiling (2,147,483,647 ms, about 24.8
    // days) overflows and fires almost immediately. Forty days out must arm the
    // start timers without tripping them.
    jest.setSystemTime(new Date("2026-05-03T09:00:00"));
    await seedGatheringAndMass();

    const scheduledDelays = [];
    const passthrough = global.setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, "setTimeout")
      .mockImplementation((callback, delay, ...rest) => {
        scheduledDelays.push(delay);
        return passthrough(callback, delay, ...rest);
      });

    try {
      await request(app)
        .post("/api/start-time")
        .send({ time: "2026-06-12T10:00:00" })
        .expect(200);

      jest.advanceTimersByTime(60 * 1000);

      const res = await request(app).get("/api/state").expect(200);
      expect(res.body.gatheringRunning).toBe(false);
      expect(res.body.preMassRunning).toBe(false);
      expect(res.body.currentSlideIndex).toBe(0);

      const longDelays = scheduledDelays.filter((delay) => delay > 60 * 1000);
      expect(longDelays.length).toBeGreaterThan(0);
      expect(Math.max(...longDelays)).toBeLessThanOrEqual(2147483647);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
