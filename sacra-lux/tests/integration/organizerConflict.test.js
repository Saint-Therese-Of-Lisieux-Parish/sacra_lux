const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("organizer save conflicts", () => {
  let handle;
  let state;

  beforeEach(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-organizer-conflict-")
    });
    ({ state } = require("../../src/state"));
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

  test.each(["__proto__", "constructor", "prototype"])(
    "does not pollute Object.prototype for a reserved slide ID (%s)",
    async (id) => {
      const sequence = [{ id, type: "text", label: "Reserved ID", phase: "mass" }];
      const manualSlides = JSON.parse(`{"${id}":{"text":"Reserved ID"}}`);

      await request(handle.app)
        .post("/api/organizer")
        .send({ sequence, manualSlides })
        .expect(200);

      expect(Object.prototype.polluted).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    }
  );

  test("rejects an organizer save after settings import changes the revision", async () => {
    const initial = await request(handle.app).get("/api/state").expect(200);
    const staleRevision = initial.body.organizerRevision;

    await request(handle.app)
      .post("/api/import-settings")
      .send({
        organizerSequence: [{ id: "imported", type: "text", label: "Imported", phase: "mass" }],
        manualSlides: { imported: { text: "Imported" } }
      })
      .expect(200);

    const current = await request(handle.app).get("/api/state").expect(200);
    expect(current.body.organizerRevision).toBe(staleRevision + 1);

    await request(handle.app)
      .post("/api/organizer")
      .send({ sequence: [], manualSlides: {}, organizerRevision: staleRevision })
      .expect(409);
  });

  test("keeps runtime state when organizer validation fails", async () => {
    const endsAt = Date.now() + 5000;
    state.startupPrompt = { reason: "invalid-current-mass" };
    state.imageSlideshowEndsAt = endsAt;
    state.imageSlideshowError = "The failed image stays skipped.";

    await request(handle.app)
      .post("/api/organizer")
      .send({ sequence: [null], manualSlides: {} })
      .expect(400);

    expect(state.startupPrompt).toEqual({ reason: "invalid-current-mass" });
    expect(state.imageSlideshowEndsAt).toBe(endsAt);
    expect(state.imageSlideshowError).toBe("The failed image stays skipped.");
  });

  test("rejects a slideshow with more than 500 images", async () => {
    const before = await request(handle.app).get("/api/state").expect(200);
    const sequence = [{ id: "large-slideshow", type: "imageSlideshow", label: "Slides", phase: "pre" }];
    const images = Array.from({ length: 501 }, (_, index) => ({
      url: `/api/mass-asset/image-${index}.png`,
      name: `image-${index}.png`
    }));

    const response = await request(handle.app)
      .post("/api/organizer")
      .send({ sequence, manualSlides: { "large-slideshow": { images } } })
      .expect(400);

    expect(response.body.error).toBe("A slideshow can contain at most 500 images.");

    const after = await request(handle.app).get("/api/state").expect(200);
    expect(after.body.organizerRevision).toBe(before.body.organizerRevision);
    expect(after.body.organizerSequence).toEqual(before.body.organizerSequence);
    expect(after.body.manualSlides).toEqual(before.body.manualSlides);
  });
});
