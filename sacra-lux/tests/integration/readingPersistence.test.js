const request = require("supertest");

const {
  createTempHome,
  loadReadingsFolder,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("reading persistence", () => {
  let homeDir;

  async function boot() {
    jest.resetModules();
    return startIsolatedServer({ port: 0, homeDir });
  }

  beforeEach(() => {
    homeDir = createTempHome("sacra-lux-reading-persistence-");
  });

  test("a saved reading remains after a server restart", async () => {
    const first = await boot();
    const readingsDir = makeReadingsFolder(homeDir);
    await loadReadingsFolder(first.app, readingsDir);

    await request(first.app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "The saved reading text." })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      const reading = state.readingsSource.documents.find((entry) => entry.stem === "Reading_I");
      expect(reading.textLines).toContain("The saved reading text.");
    } finally {
      await restarted.stop();
    }
  });
});
