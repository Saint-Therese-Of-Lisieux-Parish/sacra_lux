const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

// Keep I/O and microtask scheduling real so supertest's HTTP round-trips still
// resolve while Date and setTimeout are faked.
const FAKE_TIMER_EXCLUSIONS = [
  "nextTick",
  "queueMicrotask",
  "setImmediate",
  "clearImmediate",
  "hrtime",
  "performance"
];

describe("movie slides auto-advance", () => {
  let handle;
  let app;
  let resetSecurityState;
  let state;

  const moviePreSequence = (overrides = {}) => [
    {
      id: "movie-intro",
      type: "movie",
      label: "Intro",
      phase: "pre",
      backgroundTheme: "light",
      durationSec: 10,
      ...overrides
    },
    { id: "pre-text", type: "text", label: "Welcome", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
  ];

  const moviePreManualSlides = (movieOverrides = {}) => ({
    "movie-intro": {
      text: "",
      notes: "",
      videoUrl: "/api/mass-asset/welcome.mp4",
      videoLoop: false,
      videoAutoAdvance: true,
      ...movieOverrides
    },
    "pre-text": { text: "Welcome" }
  });

  async function seed(sequence, manualSlides) {
    await request(app).post("/api/start-time").send({ time: "" }).expect(200);
    await request(app)
      .post("/api/organizer")
      .send({ sequence, manualSlides })
      .expect(200);
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-movie-") });
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

  test("a movie with no end report advances after its duration", async () => {
    await seed(moviePreSequence(), moviePreManualSlides());

    await request(app).post("/api/pre-mass/start").expect(200);
    let res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(0);
    expect(res.body.presentation.slides[0].type).toBe("movie");

    jest.advanceTimersByTime(10 * 1000);

    res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(1);
  });

  test("a movie with no video selected still advances after its duration", async () => {
    await seed(moviePreSequence(), moviePreManualSlides({ videoUrl: null }));

    await request(app).post("/api/pre-mass/start").expect(200);
    jest.advanceTimersByTime(10 * 1000);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(1);
  });

  test("a looping movie stays on its slide", async () => {
    await seed(moviePreSequence(), moviePreManualSlides({ videoLoop: true }));

    await request(app).post("/api/pre-mass/start").expect(200);
    jest.advanceTimersByTime(60 * 1000);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(0);
  });

  test("a movie that does not auto-advance stays on its slide", async () => {
    await seed(moviePreSequence(), moviePreManualSlides({ videoAutoAdvance: false }));

    await request(app).post("/api/pre-mass/start").expect(200);
    jest.advanceTimersByTime(60 * 1000);

    const res = await request(app).get("/api/state").expect(200);
    expect(res.body.currentSlideIndex).toBe(0);
  });
});
