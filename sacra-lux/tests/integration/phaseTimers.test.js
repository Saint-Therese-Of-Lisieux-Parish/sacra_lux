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
  });

  beforeEach(() => {
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
