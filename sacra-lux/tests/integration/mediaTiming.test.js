const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const FAKE_TIMER_EXCLUSIONS = [
  "nextTick",
  "queueMicrotask",
  "setImmediate",
  "clearImmediate",
  "hrtime",
  "performance"
];

describe("automated media timing", () => {
  let handle;
  let app;
  let state;
  let client;

  const slideshowImages = (count = 2) => Array.from({ length: count }, (_, index) => ({
    url: `/uploads/timing-${index}.png`,
    name: `Timing-${index}.png`
  }));

  async function saveOrganizer(sequence, manualSlides) {
    await request(app)
      .post("/api/organizer")
      .send({ sequence, manualSlides })
      .expect(200);
  }

  async function connectClient() {
    client = createClient(handle.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  }

  async function flushSocket() {
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-media-timing-") });
    app = handle.app;
    ({ state } = require("../../src/state"));
  });

  beforeEach(() => {
    jest.useRealTimers();
    state.startPin = "";
    state.startPinHash = null;
    state.preMassRunning = false;
    state.gatheringRunning = false;
    state.postMassRunning = false;
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
      client = null;
    }
    jest.useRealTimers();
  });

  afterAll(async () => {
    await handle.close();
  });

  test("keeps slideshow timing exact in pre-Mass, gathering, and post-Mass", async () => {
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });
    await request(app).post("/api/new-mass").send({ title: "Media Timing", startTime: "" }).expect(200);

    const preImages = slideshowImages();
    const gatheringImages = slideshowImages();
    const postImages = slideshowImages();
    await saveOrganizer(
      [
        { id: "pre-show", type: "imageSlideshow", label: "Pre", phase: "pre", backgroundTheme: "light", durationSec: 1 },
        { id: "gathering-show", type: "imageSlideshow", label: "Gathering", phase: "gathering", backgroundTheme: "light", durationSec: 1 },
        { id: "mass-title", type: "text", label: "Mass", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
        { id: "post-show", type: "imageSlideshow", label: "Post", phase: "post", backgroundTheme: "light", durationSec: 1 }
      ],
      {
        "pre-show": { images: preImages, slideshowDurationSec: 1, slideshowLoopCount: 1 },
        "gathering-show": { images: gatheringImages, slideshowDurationSec: 1, slideshowLoopCount: 1 },
        "mass-title": { text: "Mass" },
        "post-show": { images: postImages, slideshowDurationSec: 1, slideshowLoopCount: 1 }
      }
    );

    await request(app).post("/api/pre-mass/start").expect(200);
    let response = await request(app).get("/api/state").expect(200);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].organizerItemId).toBe("pre-show");
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].slideshowImageIndex).toBe(1);
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].slideshowImageIndex).toBe(0);

    await request(app).post("/api/pre-mass/stop").expect(200);
    await request(app).post("/api/gathering/start").expect(200);
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].slideshowImageIndex).toBe(1);
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.gatheringRunning).toBe(false);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].organizerItemId).toBe("mass-title");

    await request(app).post("/api/post-mass/start").expect(200);
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].slideshowImageIndex).toBe(1);
    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.postMassRunning).toBe(true);
    expect(response.body.presentation.slides[response.body.currentSlideIndex].organizerItemId).toBe("post-show");
  });

  test("anchors a movie fallback to the slide start when metadata arrives late", async () => {
    await request(app).post("/api/new-mass").send({ title: "Movie Timing", startTime: "" }).expect(200);
    await saveOrganizer(
      [
        { id: "movie-intro", type: "movie", label: "Intro", phase: "pre", backgroundTheme: "light", durationSec: 10 },
        { id: "after-movie", type: "text", label: "After", phase: "pre", backgroundTheme: "dark", durationSec: 10 }
      ],
      {
        "movie-intro": { videoUrl: "/uploads/intro.mp4", videoLoop: false, videoAutoAdvance: true },
        "after-movie": { text: "After" }
      }
    );
    await connectClient();
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    let response = await request(app).get("/api/state").expect(200);
    const slideId = response.body.presentation.slides[response.body.currentSlideIndex].id;

    jest.advanceTimersByTime(2000);
    client.emit("slide:video-ready", { slideId, durationMs: 30000 });
    await flushSocket();

    jest.advanceTimersByTime(27999);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(0);
    jest.advanceTimersByTime(1);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(1);
  });
});
