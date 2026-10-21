const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("interstitial hold return slide", () => {
  let handle;
  let app;
  let state;
  let client;

  const sequence = [
    { id: "opening", type: "text", label: "Opening", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
    { id: "hold", type: "interstitial", label: "Hold", phase: "mass", backgroundTheme: "light", durationSec: 10 },
    { id: "live", type: "text", label: "Live", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
    { id: "later", type: "text", label: "Later", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
  ];

  const manualSlides = {
    opening: { text: "Opening" },
    hold: { text: "" },
    live: { text: "Live" },
    later: { text: "Later" }
  };

  async function connectClient() {
    client = createClient(handle.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  }

  function waitForState(predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.off("state:update", onUpdate);
        reject(new Error("Timed out while waiting for state."));
      }, 3000);
      const onUpdate = (snapshot) => {
        if (!predicate(snapshot)) {
          return;
        }
        clearTimeout(timeout);
        client.off("state:update", onUpdate);
        resolve(snapshot);
      };
      client.on("state:update", onUpdate);
    });
  }

  async function emitAndWait(event, payload, predicate) {
    const pending = waitForState(predicate);
    if (payload === undefined) {
      client.emit(event);
    } else {
      client.emit(event, payload);
    }
    return pending;
  }

  async function loadMassAtLiveSlide() {
    await request(app).post("/api/new-mass").send({ title: "Hold Return", startTime: "" }).expect(200);
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    await connectClient();
    const snapshot = await emitAndWait("slide:goto", 2, (next) => next.currentSlideIndex === 2);
    expect(snapshot.presentation.slides[1].type).toBe("interstitial");
    expect(snapshot.presentation.slides[2].organizerItemId).toBe("live");
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-interstitial-hold-")
    });
    app = handle.app;
    ({ state } = require("../../src/state"));
  });

  beforeEach(() => {
    state.startPin = "";
    state.startPinHash = null;
  });

  afterEach(() => {
    if (client) {
      client.disconnect();
      client = null;
    }
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  test("keeps the stored return slide when the operator presses next", async () => {
    await loadMassAtLiveSlide();

    await emitAndWait("screen:interstitial-hold", undefined, (next) => next.interstitialHoldActive === true);
    expect(state.interstitialHoldReturnSlideIndex).toBe(2);

    await emitAndWait("slide:prev", undefined, (next) => next.currentSlideIndex === 1);
    expect(state.interstitialHoldReturnSlideIndex).toBe(2);

    await emitAndWait("slide:next", undefined, (next) => next.currentSlideIndex === 2);
    await emitAndWait("slide:next", undefined, (next) => next.currentSlideIndex === 3);
    expect(state.interstitialHoldReturnSlideIndex).toBe(2);
    expect(state.interstitialHoldActive).toBe(true);
  });

  test("returns to the slide that was live when the hold started", async () => {
    await loadMassAtLiveSlide();

    await emitAndWait("screen:interstitial-hold", undefined, (next) => next.interstitialHoldActive === true);
    await emitAndWait("slide:next", undefined, (next) => next.currentSlideIndex === 3);
    const released = await emitAndWait(
      "screen:interstitial-hold",
      { returnSlideIndex: 3 },
      (next) => next.interstitialHoldActive === false
    );

    expect(released.currentSlideIndex).toBe(2);
    expect(state.interstitialHoldReturnSlideIndex).toBeNull();
  });

  test("returns to the cue the operator chooses", async () => {
    await loadMassAtLiveSlide();

    await emitAndWait("screen:interstitial-hold", undefined, (next) => next.interstitialHoldActive === true);
    await emitAndWait("slide:next", undefined, (next) => next.currentSlideIndex === 3);
    const released = await emitAndWait(
      "screen:interstitial-hold",
      { returnSlideIndex: 0, explicitReturn: true },
      (next) => next.interstitialHoldActive === false && next.currentSlideIndex === 0
    );

    expect(released.currentSlideIndex).toBe(0);
  });
});
