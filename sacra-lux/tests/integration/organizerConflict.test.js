const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("organizer save conflicts", () => {
  let handle;

  beforeEach(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-organizer-conflict-")
    });
  });

  afterEach(async () => {
    await handle.stop();
  });

  test("rejects a save based on an older organizer revision", async () => {
    const initial = await request(handle.app).get("/api/state").expect(200);
    const staleRevision = initial.body.organizerRevision;
    const sequence = [
      {
        id: "conflict-text",
        type: "text",
        label: "First change",
        phase: "mass",
        backgroundTheme: "dark",
        durationSec: 0
      }
    ];
    const manualSlides = { "conflict-text": { text: "First change" } };

    await request(handle.app)
      .post("/api/organizer")
      .send({ sequence, manualSlides, organizerRevision: staleRevision })
      .expect(200);

    const current = await request(handle.app).get("/api/state").expect(200);
    expect(current.body.organizerRevision).toBe(staleRevision + 1);

    const staleResponse = await request(handle.app)
      .post("/api/organizer")
      .send({
        sequence: [{ ...sequence[0], label: "Stale change" }],
        manualSlides,
        organizerRevision: staleRevision
      })
      .expect(409);

    expect(staleResponse.body.error).toMatch(/saved first/i);
    expect(staleResponse.body.organizerRevision).toBe(current.body.organizerRevision);

    const afterConflict = await request(handle.app).get("/api/state").expect(200);
    expect(afterConflict.body.organizerSequence[0].label).toBe("First change");
  });

  test("keeps legacy organizer requests working when no revision is sent", async () => {
    await request(handle.app)
      .post("/api/organizer")
      .send({ sequence: [], manualSlides: {} })
      .expect(200);
  });
});
