const fs = require("fs");
const path = require("path");
const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");

// Restore frozen files from earlier releases into a fresh home directory.
// Do not edit the fixtures to make a test pass. A change to them means a
// change to the stored format that older installs still hold.
describe("restore from session.json v2 and current_mass/mass.json v3 fixtures", () => {
  let handle;

  beforeAll(async () => {
    jest.resetModules();
    const homeDir = createTempHome("sacra-lux-fixtures-");
    const dataDir = path.join(homeDir, ".sacra-lux");
    fs.mkdirSync(path.join(dataDir, "current_mass"), { recursive: true });
    fs.copyFileSync(path.join(FIXTURE_DIR, "session-v2.json"), path.join(dataDir, "session.json"));
    fs.copyFileSync(path.join(FIXTURE_DIR, "mass-v3.json"), path.join(dataDir, "current_mass", "mass.json"));
    handle = await startIsolatedServer({ port: 0, homeDir });
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  test("rebuilds the organizer and slides from current_mass", async () => {
    const res = await request(handle.app).get("/api/state").expect(200);
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "mass-v3.json"), "utf8"));

    expect(res.body.presentation.title).toBe("Fixture Sunday");
    expect(res.body.organizerSequence.map((item) => item.id)).toEqual(fixture.items.map((item) => item.id));
    expect(res.body.massStartTime).toBe("2026-04-12T10:30:00-04:00");
  });

  test("restores session settings from session.json v2", async () => {
    const res = await request(handle.app).get("/api/state").expect(200);

    expect(res.body.appSettings).toMatchObject({ theme: "dark" });
    expect(res.body.screenFullscreen).toBe(true);
  });
});
