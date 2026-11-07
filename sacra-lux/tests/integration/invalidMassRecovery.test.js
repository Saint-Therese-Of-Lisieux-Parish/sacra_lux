const fs = require("fs");
const path = require("path");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

function invalidMassPath(homeDir) {
  return path.join(homeDir, ".sacra-lux", "current_mass", "mass.json");
}

describe("invalid current Mass protection", () => {
  async function startWithInvalidMass() {
    const homeDir = createTempHome("sacra-lux-invalid-mass-");
    const massPath = invalidMassPath(homeDir);
    fs.mkdirSync(path.dirname(massPath), { recursive: true });
    fs.writeFileSync(massPath, "{not json", "utf8");
    jest.resetModules();
    const handle = await startIsolatedServer({ port: 0, homeDir });
    return { handle, massPath };
  }

  test("preserves the invalid Mass before an organizer save", async () => {
    const { handle, massPath } = await startWithInvalidMass();
    try {
      await request(handle.app)
        .post("/api/organizer")
        .send({ sequence: [], manualSlides: {} })
        .expect(200);

      const recoveryDir = path.join(handle.homeDir, ".sacra-lux", "recovery");
      const recoveryFiles = fs.readdirSync(recoveryDir);
      expect(recoveryFiles).toHaveLength(1);
      expect(fs.readFileSync(path.join(recoveryDir, recoveryFiles[0]), "utf8"))
        .toBe(fs.readFileSync(massPath, "utf8"));
    } finally {
      await handle.stop();
    }
  });

  test("rejects title edits while the invalid Mass prompt is active", async () => {
    const { handle, massPath } = await startWithInvalidMass();
    try {
      await request(handle.app)
        .post("/api/update-title")
        .send({ title: "Unsafe edit" })
        .expect(409);

      expect(fs.readFileSync(massPath, "utf8")).toBe("{not json");
    } finally {
      await handle.stop();
    }
  });

  test("rejects asset cleanup while no Mass is loaded", async () => {
    const { handle } = await startWithInvalidMass();
    try {
      const assetPath = path.join(handle.homeDir, ".sacra-lux", "current_mass", "assets", "photo.png");
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, "not an image", "utf8");

      await request(handle.app)
        .post("/api/remove-unused-mass-assets")
        .expect(409);

      expect(fs.existsSync(assetPath)).toBe(true);
    } finally {
      await handle.stop();
    }
  });
});
