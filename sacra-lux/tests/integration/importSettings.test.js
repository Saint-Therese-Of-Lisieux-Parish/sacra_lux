const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("settings import and export", () => {
  let handle;
  let app;
  let state;
  let clearRateLimitState;

  const sequence = [
    { id: "one", type: "text", label: "One", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
    { id: "two", type: "text", label: "Two", phase: "mass", backgroundTheme: "dark", durationSec: 10 }
  ];
  const manualSlides = { one: { text: "One" }, two: { text: "Two" } };

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-import-") });
    app = handle.app;
    ({ state } = require("../../src/state"));
    ({ clearRateLimitState } = require("../../src/security"));
  });

  beforeEach(async () => {
    state.startPin = "";
    state.startPinHash = null;
    clearRateLimitState();
    await request(app).post("/api/new-mass").send({ title: "Import Mass", startTime: "" }).expect(200);
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("an empty payload changes nothing and succeeds", async () => {
    const before = JSON.stringify(state.screenSettings);
    await request(app).post("/api/import-settings").send({}).expect(200);
    expect(JSON.stringify(state.screenSettings)).toBe(before);
  });

  test("a full payload replaces settings, organizer, title, and start time", async () => {
    const start = "2030-01-01T09:00";
    await request(app).post("/api/import-settings").send({
      screenSettings: { fontSizePx: 80 },
      organizerSequence: sequence,
      manualSlides,
      presentationTitle: "Imported Title",
      massStartTime: start
    }).expect(200);

    expect(state.screenSettings.fontSizePx).toBe(80);
    expect(state.organizerSequence.map((item) => item.id)).toEqual(["one", "two"]);
    expect(state.presentation.title).toBe("Imported Title");
    expect(state.massStartTime).toBe(start);
    expect(state.presentation.slides.length).toBeGreaterThan(0);
  });

  test("rejects a background URL outside the allow-list and changes nothing", async () => {
    const before = JSON.stringify(state.screenSettings);
    await request(app).post("/api/import-settings").send({
      screenSettings: { darkBackgroundUrl: "javascript:alert(1)" }
    }).expect(400);
    expect(JSON.stringify(state.screenSettings)).toBe(before);
  });

  test("rejects an image or movie URL outside the allow-list", async () => {
    const before = JSON.stringify(state.manualSlides);
    await request(app).post("/api/import-settings").send({
      manualSlides: { one: { imageUrl: "https://evil.example/a.png" } }
    }).expect(400);
    await request(app).post("/api/import-settings").send({
      manualSlides: { one: { videoUrl: "https://evil.example/a.mp4" } }
    }).expect(400);
    expect(JSON.stringify(state.manualSlides)).toBe(before);
  });

  test("rejects a movie URL outside the allow-list in the organizer", async () => {
    await request(app).post("/api/organizer").send({
      sequence,
      manualSlides: { v: { videoUrl: "https://evil.example/a.mp4" } }
    }).expect(400);
  });

  test("rejects an encoded path separator in an asset URL", async () => {
    const before = JSON.stringify(state.manualSlides);
    await request(app).post("/api/organizer").send({
      sequence,
      manualSlides: { one: { imageUrl: "/api/mass-asset/..%2Fx.png" } }
    }).expect(400);
    await request(app).post("/api/import-settings").send({
      manualSlides: { one: { imageUrl: "/api/mass-asset/..%2Fx.png" } }
    }).expect(400);
    expect(JSON.stringify(state.manualSlides)).toBe(before);
  });

  test("accepts built-in background URLs", async () => {
    await request(app).post("/api/import-settings").send({
      screenSettings: { darkBackgroundUrl: "/static/assets/default-text-background.avif" }
    }).expect(200);
  });

  test("a null start time clears the start time", async () => {
    await request(app).post("/api/import-settings").send({ massStartTime: "2030-01-01T09:00" }).expect(200);
    await request(app).post("/api/import-settings").send({ massStartTime: null }).expect(200);
    expect(state.massStartTime).toBeNull();
  });

  test("manual slides alone rebuild the presentation from the stored sequence", async () => {
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    await request(app).post("/api/import-settings").send({
      manualSlides: { one: { text: "Changed" }, two: { text: "Two" } }
    }).expect(200);
    expect(state.manualSlides.one.text).toBe("Changed");
  });

  test("ignores settings, sequence, and slides of the wrong type", async () => {
    const before = JSON.stringify(state.organizerSequence);
    await request(app).post("/api/import-settings").send({
      screenSettings: "nope",
      organizerSequence: "nope",
      manualSlides: "nope",
      presentationTitle: "",
      massStartTime: 12
    }).expect(400);
    expect(JSON.stringify(state.organizerSequence)).toBe(before);
  });

  test("an export round-trips through an import", async () => {
    await request(app).post("/api/organizer").send({ sequence, manualSlides }).expect(200);
    const exported = await request(app).get("/api/export-settings").expect(200);
    expect(exported.headers["content-disposition"]).toMatch(/mass-settings-\d{4}-\d{2}-\d{2}\.json/);
    expect(exported.body.version).toBe(2);

    await request(app).post("/api/import-settings").send(exported.body).expect(200);
    expect(state.organizerSequence.map((item) => item.id)).toEqual(["one", "two"]);
  });
});
