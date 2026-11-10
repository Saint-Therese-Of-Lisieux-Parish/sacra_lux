const fs = require("fs");
const path = require("path");
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

describe("phase slide timers", () => {
  let handle;
  let app;
  let state;
  let client;
  let resetSecurityState;

  const textItem = (id, phase, durationSec = 1) => ({
    id,
    type: "text",
    label: id,
    phase,
    backgroundTheme: "dark",
    durationSec
  });

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
    for (let index = 0; index < 8; index += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  function watchUpdates() {
    const updates = [];
    const onUpdate = (snapshot) => updates.push(snapshot);
    client.on("state:update", onUpdate);
    return {
      updates,
      stop() {
        client.off("state:update", onUpdate);
      }
    };
  }

  function slideId(snapshot) {
    return snapshot.presentation.slides[snapshot.currentSlideIndex].organizerItemId;
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-phase-timers-")
    });
    app = handle.app;
    ({ state } = require("../../src/state"));
    ({ resetSecurityState } = require("../../src/security"));
  });

  beforeEach(() => {
    resetSecurityState();
    jest.useRealTimers();
    state.startPin = "";
    state.startPinHash = null;
    state.preMassRunning = false;
    state.gatheringRunning = false;
    state.postMassRunning = false;
    state.countdownEndsAt = null;
  });

  afterEach(async () => {
    jest.useRealTimers();
    if (client) {
      client.disconnect();
      client = null;
    }
    await request(app).post("/api/pre-mass/stop").catch(() => {});
    await request(app).post("/api/gathering/stop").catch(() => {});
    await request(app).post("/api/post-mass/stop").catch(() => {});
  });

  afterAll(async () => {
    await handle.stop();
  });

  test("advances each pre-Mass slide and emits state:update", async () => {
    await request(app).post("/api/new-mass").send({ title: "Pre sequence", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("pre-a", "pre"), textItem("pre-b", "pre"), textItem("mass", "mass", 10)],
      { "pre-a": { text: "A" }, "pre-b": { text: "B" }, mass: { text: "Mass" } }
    );
    await connectClient();
    const watch = watchUpdates();
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    await flushSocket();
    let response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("pre-a");
    expect(response.body.preMassRunning).toBe(true);

    const before = watch.updates.length;
    jest.advanceTimersByTime(1000);
    await flushSocket();
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("pre-b");
    expect(watch.updates.slice(before).some((snapshot) => slideId(snapshot) === "pre-b")).toBe(true);
    watch.stop();
  });

  test("logs a phase timer error and keeps the server running", async () => {
    await request(app).post("/api/new-mass").send({ title: "Timer guard", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("pre-a", "pre"), textItem("pre-b", "pre"), textItem("mass", "mass", 10)],
      { "pre-a": { text: "A" }, "pre-b": { text: "B" }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });
    await request(app).post("/api/pre-mass/start").expect(200);

    const presentationDescriptor = Object.getOwnPropertyDescriptor(state, "presentation");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(state, "presentation", {
      configurable: true,
      get() {
        throw new Error("simulated phase timer failure");
      }
    });

    try {
      jest.advanceTimersByTime(1000);
      await flushSocket();
      expect(errorSpy.mock.calls.some((call) =>
        String(call[0]).startsWith("[timer] preMass failed:")
      )).toBe(true);
    } finally {
      Object.defineProperty(state, "presentation", presentationDescriptor);
      errorSpy.mockRestore();
    }

    await request(app).get("/api/state").expect(200);
  });

  test("reschedules a pre-Mass timer after a short forward clock jump", async () => {
    await request(app).post("/api/new-mass").send({ title: "Pre resume", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("pre-a", "pre", 20), textItem("pre-b", "pre", 20), textItem("mass", "mass", 10)],
      { "pre-a": { text: "A" }, "pre-b": { text: "B" }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    const start = Date.now();
    jest.setSystemTime(start + 1000);
    handle.rescheduleStartTimer();
    jest.advanceTimersByTime(0);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("pre-a");
    expect(response.body.preMassRunning).toBe(true);
  });

  test.each([
    ["pre-Mass", "pre", "/api/pre-mass/start", "pre-a", "pre-b"],
    ["gathering", "gathering", "/api/gathering/start", "gather-a", "gather-b"],
    ["post-Mass", "post", "/api/post-mass/start", "post-a", "post-b"]
  ])("does not replay missed %s slides after a wake", async (_name, phase, startRoute, firstId, secondId) => {
    await saveOrganizer(
      [
        textItem("mass", "mass", 10),
        textItem(firstId, phase, 10),
        textItem(secondId, phase, 10)
      ],
      {
        mass: { text: "Mass" },
        [firstId]: { text: "First" },
        [secondId]: { text: "Second" }
      }
    );
    await connectClient();
    const watch = watchUpdates();
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post(startRoute).expect(200);
    const updateStart = watch.updates.length;
    const start = Date.now();
    jest.setSystemTime(start + 60 * 60 * 1000);
    handle.rescheduleStartTimer();
    jest.advanceTimersByTime(2000);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe(firstId);
    expect(watch.updates.slice(updateStart).filter((snapshot) => slideId(snapshot) !== firstId)).toHaveLength(0);
    watch.stop();
  });

  test("reschedules a countdown timer after a forward clock jump", async () => {
    await request(app).post("/api/new-mass").send({ title: "Countdown resume", startTime: "" }).expect(200);
    await saveOrganizer(
      [
        { id: "g-count", type: "countdown", label: "Gather count", phase: "gathering", backgroundTheme: "dark", durationSec: 60 },
        textItem("mass", "mass", 10)
      ],
      { "g-count": { countdownSec: 30 }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/gathering/start").expect(200);
    const start = Date.now();
    jest.setSystemTime(start + 60000);
    handle.rescheduleStartTimer();
    jest.advanceTimersByTime(0);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass");
    expect(response.body.countdownEndsAt).toBeNull();
  });

  test.each([
    { name: "next image", current: 0, iteration: 1, loops: 1, expected: 1, expectedIteration: 1 },
    { name: "next loop", current: 2, iteration: 1, loops: 2, expected: 0, expectedIteration: 2 },
    { name: "next organizer item", current: 2, iteration: 2, loops: 2, expected: 3, expectedIteration: 1 }
  ])("keeps the slideshow after a wake at the $name", async ({ current, iteration, loops, expected, expectedIteration }) => {
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    for (const name of ["one.png", "two.png", "three.png"]) fs.writeFileSync(path.join(assetsDir, name), image);
    await saveOrganizer(
      [
        {
          id: "wake-show",
          type: "imageSlideshow",
          label: "Wake slideshow",
          phase: "mass",
          backgroundTheme: "light",
          durationSec: 10
        },
        textItem("after", "mass", 10)
      ],
      {
        "wake-show": {
          images: [
            { url: "/static/assets/one.png", name: "one.png" },
            { url: "/static/assets/two.png", name: "two.png" },
            { url: "/static/assets/three.png", name: "three.png" }
          ],
          slideshowDurationSec: 10,
          slideshowLoopCount: loops
        },
        after: { text: "After" }
      }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });
    const slideshowIndices = state.presentation.slides
      .map((slide, index) => slide.organizerItemId === "wake-show" ? index : -1)
      .filter((index) => index >= 0);
    state.currentSlideIndex = slideshowIndices[current] ?? state.presentation.slides.findIndex((slide) => slide.organizerItemId === "after");
    state.imageSlideshowLoopIteration = iteration;
    state.imageSlideshowEndsAt = Date.now() - 1000;

    handle.rescheduleStartTimer();

    const response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(slideshowIndices[expected] ?? response.body.presentation.slides.findIndex((slide) => slide.organizerItemId === "after"));
    expect(response.body.imageSlideshowLoopIteration).toBe(expectedIteration);
  });

  test("starts the Mass when the last gathering slide ends", async () => {
    await request(app).post("/api/new-mass").send({ title: "Gathering sequence", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("gather-a", "gathering"), textItem("gather-b", "gathering"), textItem("mass", "mass", 10)],
      { "gather-a": { text: "A" }, "gather-b": { text: "B" }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/gathering/start").expect(200);
    let response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("gather-a");

    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("gather-b");
    expect(response.body.gatheringRunning).toBe(true);

    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass");
    expect(response.body.gatheringRunning).toBe(false);
  });

  test("starts the first Mass countdown when gathering ends", async () => {
    await saveOrganizer(
      [textItem("gather", "gathering"), { id: "mass-count", type: "countdown", label: "Mass count", phase: "mass", backgroundTheme: "dark", durationSec: 3 }],
      { gather: { text: "Gather" }, "mass-count": { countdownSec: 1 } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });
    await connectClient();
    const watch = watchUpdates();

    await request(app).post("/api/gathering/start").expect(200);
    jest.advanceTimersByTime(1000);
    await flushSocket();

    let response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass-count");
    expect(response.body.countdownEndsAt).not.toBeNull();
    expect(watch.updates.at(-1).gatheringRunning).toBe(false);

    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass-count");
    watch.stop();

    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(assetsDir, "one.png"),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
    );
    await saveOrganizer(
      [{ id: "mass-show", type: "imageSlideshow", label: "Mass images", phase: "mass", backgroundTheme: "dark", durationSec: 3 }],
      { "mass-show": { images: [{ url: "/static/assets/one.png", name: "one.png" }], slideshowDurationSec: 1, slideshowLoopCount: 1 } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/gathering/start").expect(200);

    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass-show");
    expect(response.body.imageSlideshowEndsAt).not.toBeNull();
  });

  test("resets image slideshow progress when a new phase starts", async () => {
    const assetsDir = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(assetsDir, "phase.png"), image);
    await saveOrganizer(
      [
        {
          id: "pre-show",
          type: "imageSlideshow",
          label: "Pre slideshow",
          phase: "pre",
          backgroundTheme: "dark",
          durationSec: 1
        },
        {
          id: "gather-show",
          type: "imageSlideshow",
          label: "Gathering slideshow",
          phase: "gathering",
          backgroundTheme: "dark",
          durationSec: 1
        },
        textItem("mass", "mass", 10),
        {
          id: "post-show",
          type: "imageSlideshow",
          label: "Post slideshow",
          phase: "post",
          backgroundTheme: "dark",
          durationSec: 1
        }
      ],
      {
        "pre-show": { images: [{ url: "/static/assets/phase.png", name: "phase.png" }], slideshowDurationSec: 1, slideshowLoopCount: 5 },
        "gather-show": { images: [{ url: "/static/assets/phase.png", name: "phase.png" }], slideshowDurationSec: 1, slideshowLoopCount: 3 },
        mass: { text: "Mass" },
        "post-show": { images: [{ url: "/static/assets/phase.png", name: "phase.png" }], slideshowDurationSec: 1, slideshowLoopCount: 3 }
      }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    jest.advanceTimersByTime(2000);
    await flushSocket();
    let response = await request(app).get("/api/state").expect(200);
    expect(response.body.imageSlideshowLoopIteration).toBe(3);

    await request(app).post("/api/gathering/start").expect(200);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("gather-show");
    expect(response.body.imageSlideshowLoopIteration).toBe(1);

    jest.advanceTimersByTime(3000);
    await flushSocket();
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("mass");

    state.imageSlideshowLoopIteration = 2;
    await request(app).post("/api/post-mass/start").expect(200);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-show");
    expect(response.body.imageSlideshowLoopIteration).toBe(1);
  });

  test("advances post-Mass slides and stays in the post-Mass loop", async () => {
    await request(app).post("/api/new-mass").send({ title: "Post sequence", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("mass", "mass", 10), textItem("post-a", "post"), textItem("post-b", "post")],
      { mass: { text: "Mass" }, "post-a": { text: "A" }, "post-b": { text: "B" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/post-mass/start").expect(200);
    let response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-a");

    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-b");
    expect(response.body.postMassRunning).toBe(true);

    jest.advanceTimersByTime(1000);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-a");
    expect(response.body.postMassRunning).toBe(true);

    await request(app).post("/api/post-mass/stop").expect(200);
    const stoppedIndex = (await request(app).get("/api/state").expect(200)).body.currentSlideIndex;
    jest.advanceTimersByTime(5000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(stoppedIndex);
    expect(response.body.postMassRunning).toBe(false);
  });

  test("loops pre-Mass when the last slide is a countdown", async () => {
    await request(app).post("/api/new-mass").send({ title: "Pre countdown", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("pre-a", "pre"), {
        id: "pre-countdown",
        type: "countdown",
        label: "Pre countdown",
        phase: "pre",
        backgroundTheme: "dark",
        durationSec: 1
      }, textItem("mass", "mass", 10)],
      { "pre-a": { text: "A" }, "pre-countdown": { countdownSec: 1 }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    jest.advanceTimersByTime(1000);
    await flushSocket();
    jest.advanceTimersByTime(1000);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("pre-a");
    expect(response.body.preMassRunning).toBe(true);
  });

  test("reschedules the pre-Mass loop when its countdown is removed", async () => {
    await request(app).post("/api/new-mass").send({ title: "Removed countdown", startTime: "" }).expect(200);
    await saveOrganizer(
      [{ id: "pre-countdown", type: "countdown", label: "Countdown", phase: "pre", backgroundTheme: "dark", durationSec: 1 }, textItem("mass", "mass", 10)],
      { "pre-countdown": { countdownSec: 1 }, mass: { text: "Mass" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    await saveOrganizer(
      [textItem("pre-text", "pre"), textItem("mass", "mass", 10)],
      { "pre-text": { text: "Text" }, mass: { text: "Mass" } }
    );
    jest.advanceTimersByTime(1000);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("pre-text");
    expect(response.body.preMassRunning).toBe(true);
  });

  test("loops post-Mass when the last slide is a movie", async () => {
    await request(app).post("/api/new-mass").send({ title: "Post movie", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("mass", "mass", 10), textItem("post-a", "post"), {
        id: "post-movie",
        type: "movie",
        label: "Post movie",
        phase: "post",
        backgroundTheme: "dark",
        durationSec: 1
      }],
      { mass: { text: "Mass" }, "post-a": { text: "A" }, "post-movie": { videoUrl: "/static/assets/movie.mp4" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/post-mass/start").expect(200);
    jest.advanceTimersByTime(1000);
    await flushSocket();
    jest.advanceTimersByTime(1000);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-a");
    expect(response.body.postMassRunning).toBe(true);
  });

  test("reschedules the post-Mass loop when its movie is removed", async () => {
    await request(app).post("/api/new-mass").send({ title: "Removed movie", startTime: "" }).expect(200);
    await saveOrganizer(
      [textItem("mass", "mass", 10), { id: "post-movie", type: "movie", label: "Movie", phase: "post", backgroundTheme: "dark", durationSec: 1 }],
      { mass: { text: "Mass" }, "post-movie": { videoUrl: "/static/assets/movie.mp4" } }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/post-mass/start").expect(200);
    await saveOrganizer(
      [textItem("mass", "mass", 10), textItem("post-text", "post")],
      { mass: { text: "Mass" }, "post-text": { text: "Text" } }
    );
    jest.advanceTimersByTime(1000);
    await flushSocket();

    const response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("post-text");
    expect(response.body.postMassRunning).toBe(true);
  });

  test("skips an empty slideshow forward and back", async () => {
    await request(app).post("/api/new-mass").send({ title: "Slideshow direction", startTime: "" }).expect(200);
    await saveOrganizer(
      [
        textItem("before", "mass", 10),
        {
          id: "empty-show",
          type: "imageSlideshow",
          label: "Empty",
          phase: "mass",
          backgroundTheme: "light",
          durationSec: 10
        },
        textItem("after", "mass", 10)
      ],
      {
        before: { text: "Before" },
        "empty-show": { images: [], slideshowDurationSec: 1, slideshowLoopCount: 1 },
        after: { text: "After" }
      }
    );
    await connectClient();
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    client.emit("slide:next");
    await flushSocket();
    jest.advanceTimersByTime(100);
    await flushSocket();
    let response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("after");

    const lastIndex = response.body.presentation.slides.length - 1;
    client.emit("slide:goto", lastIndex);
    await flushSocket();
    client.emit("slide:prev");
    await flushSocket();
    jest.advanceTimersByTime(100);
    await flushSocket();
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("before");
  });

  test("does not start a timer for a countdown with a bad time", async () => {
    await request(app).post("/api/new-mass").send({ title: "Bad countdown", startTime: "" }).expect(200);
    await saveOrganizer(
      [
        {
          id: "count",
          type: "countdown",
          label: "Count",
          phase: "mass",
          backgroundTheme: "dark",
          durationSec: 10
        },
        textItem("next", "mass", 10)
      ],
      { count: { countdownSec: 5 }, next: { text: "Next" } }
    );

    const countdownIndex = state.presentation.slides.findIndex((slide) => slide.type === "countdown");
    state.presentation.slides[countdownIndex].countdownSec = "bad";
    await connectClient();
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    client.emit("slide:goto", countdownIndex);
    await flushSocket();
    let response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(countdownIndex);
    expect(response.body.countdownEndsAt).toBeNull();

    jest.advanceTimersByTime(60000);
    await flushSocket();
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(countdownIndex);
    expect(response.body.countdownEndsAt).toBeNull();
  });

  test("clears sequence timers when the operator stops", async () => {
    await request(app).post("/api/new-mass").send({ title: "Stop timers", startTime: "" }).expect(200);
    await saveOrganizer(
      [
        textItem("pre-a", "pre"),
        {
          id: "gather-count",
          type: "countdown",
          label: "Gather count",
          phase: "gathering",
          backgroundTheme: "dark",
          durationSec: 10
        },
        textItem("mass", "mass", 10)
      ],
      {
        "pre-a": { text: "Pre" },
        "gather-count": { countdownSec: 2 },
        mass: { text: "Mass" }
      }
    );
    jest.useFakeTimers({ doNotFake: FAKE_TIMER_EXCLUSIONS });

    await request(app).post("/api/pre-mass/start").expect(200);
    let response = await request(app).get("/api/state").expect(200);
    const preIndex = response.body.currentSlideIndex;
    await request(app).post("/api/pre-mass/stop").expect(200);
    jest.advanceTimersByTime(5000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(preIndex);
    expect(response.body.preMassRunning).toBe(false);

    await request(app).post("/api/gathering/start").expect(200);
    response = await request(app).get("/api/state").expect(200);
    expect(slideId(response.body)).toBe("gather-count");
    expect(response.body.countdownEndsAt).not.toBeNull();
    const gatherIndex = response.body.currentSlideIndex;

    await request(app).post("/api/gathering/stop").expect(200);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.gatheringRunning).toBe(false);
    expect(response.body.countdownEndsAt).toBeNull();

    jest.advanceTimersByTime(5000);
    response = await request(app).get("/api/state").expect(200);
    expect(response.body.currentSlideIndex).toBe(gatherIndex);
    expect(slideId(response.body)).toBe("gather-count");
  });
});
