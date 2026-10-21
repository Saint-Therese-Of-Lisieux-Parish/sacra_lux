const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("remote blackout", () => {
  let handle;
  let app;
  let state;
  let client;

  const sequence = [
    { id: "one", type: "text", label: "One", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
    { id: "two", type: "text", label: "Two", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
  ];
  const manualSlides = { one: { text: "One" }, two: { text: "Two" } };

  function emitAndWait(event, payload, predicate) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.off("state:update", onUpdate);
        reject(new Error("Timed out while waiting for state."));
      }, 3000);
      const onUpdate = (snapshot) => {
        if (!predicate(snapshot)) return;
        clearTimeout(timeout);
        client.off("state:update", onUpdate);
        resolve(snapshot);
      };
      client.on("state:update", onUpdate);
      client.emit(event, payload);
    });
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-remote-blackout-")
    });
    app = handle.app;
    ({ state } = require("../../src/state"));
    await request(app).post("/api/new-mass").send({ title: "Blackout", startTime: "" }).expect(200);
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    client = createClient(handle.baseUrl, { transports: ["websocket"] });
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
    });
  });

  beforeEach(() => {
    state.startPin = "";
    state.startPinHash = null;
  });

  afterAll(async () => {
    if (client) client.disconnect();
    if (handle) await handle.stop();
  });

  test("blackout on and off keeps the current slide", async () => {
    await emitAndWait("slide:goto", 1, (next) => next.currentSlideIndex === 1);

    const dark = await emitAndWait("screen:black", true, (next) => next.isBlack === true);
    expect(dark.currentSlideIndex).toBe(1);

    const lit = await emitAndWait("screen:black", false, (next) => next.isBlack === false);
    expect(lit.currentSlideIndex).toBe(1);
  });
});
