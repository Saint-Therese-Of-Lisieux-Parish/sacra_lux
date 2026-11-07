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

function recoverySnapshot(homeDir) {
  const recoveryDir = path.join(homeDir, ".sacra-lux", "recovery");
  const recoveryFolders = fs.readdirSync(recoveryDir);
  expect(recoveryFolders).toHaveLength(1);
  const recoveryMassDir = path.join(recoveryDir, recoveryFolders[0]);
  return {
    mass: fs.readFileSync(path.join(recoveryMassDir, "mass.json"), "utf8"),
    gospel: fs.readFileSync(path.join(recoveryMassDir, "Gospel.txt"), "utf8"),
    asset: fs.readFileSync(path.join(recoveryMassDir, "assets", "photo.png"), "utf8")
  };
}

describe("invalid current Mass protection", () => {
  async function startWithInvalidMass() {
    const homeDir = createTempHome("sacra-lux-invalid-mass-");
    const massPath = invalidMassPath(homeDir);
    fs.mkdirSync(path.dirname(massPath), { recursive: true });
    fs.writeFileSync(massPath, "{not json", "utf8");
    fs.writeFileSync(path.join(path.dirname(massPath), "Gospel.txt"), "John 1:1\n\nIn the beginning", "utf8");
    fs.mkdirSync(path.join(path.dirname(massPath), "assets"), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(massPath), "assets", "photo.png"), "asset bytes", "utf8");
    jest.resetModules();
    const handle = await startIsolatedServer({ port: 0, homeDir });
    return { handle, massPath };
  }

  test("preserves the invalid Mass before an organizer save", async () => {
      const { handle } = await startWithInvalidMass();
    try {
      await request(handle.app)
        .post("/api/organizer")
        .send({ sequence: [], manualSlides: {} })
        .expect(200);

      const recoveryDir = path.join(handle.homeDir, ".sacra-lux", "recovery");
      expect(fs.existsSync(recoveryDir)).toBe(true);
      expect(recoverySnapshot(handle.homeDir)).toEqual({
        mass: "{not json",
        gospel: "John 1:1\n\nIn the beginning",
        asset: "asset bytes"
      });
    } finally {
      await handle.stop();
    }
  });

  test("preserves all files before creating a new Mass", async () => {
    const { handle } = await startWithInvalidMass();
    try {
      await request(handle.app).post("/api/new-mass").send({ title: "Next Mass" }).expect(200);
      expect(recoverySnapshot(handle.homeDir)).toEqual({
        mass: "{not json",
        gospel: "John 1:1\n\nIn the beginning",
        asset: "asset bytes"
      });
    } finally {
      await handle.stop();
    }
  });

  test("preserves all files before importing a Mass ZIP", async () => {
    const { handle } = await startWithInvalidMass();
    try {
      const AdmZip = require("adm-zip");
      const zip = new AdmZip();
      zip.addFile("mass.json", Buffer.from(JSON.stringify({
        format: "sacra-lux.mass",
        version: 3,
        metadata: { title: "Imported Mass" },
        presentationDefaults: {},
        items: []
      })));
      await request(handle.app)
        .post("/api/import-mass-zip")
        .send({ zipData: zip.toBuffer().toString("base64") })
        .expect(200);
      expect(recoverySnapshot(handle.homeDir)).toEqual({
        mass: "{not json",
        gospel: "John 1:1\n\nIn the beginning",
        asset: "asset bytes"
      });
    } finally {
      await handle.stop();
    }
  });

  test("preserves all files before loading an archive", async () => {
    const { handle } = await startWithInvalidMass();
    try {
      const packageDir = path.join(handle.homeDir, ".sacra-lux", "mass_history", "Recovery-Target", "package");
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, "mass.json"), JSON.stringify({
        format: "sacra-lux.mass",
        version: 3,
        metadata: { title: "Loaded Mass" },
        presentationDefaults: {},
        items: []
      }));
      await request(handle.app).post("/api/mass-history/Recovery-Target/load").expect(200);
      expect(recoverySnapshot(handle.homeDir)).toEqual({
        mass: "{not json",
        gospel: "John 1:1\n\nIn the beginning",
        asset: "asset bytes"
      });
    } finally {
      await handle.stop();
    }
  });

  test("keeps the current Mass when the recovery copy fails", async () => {
    const { handle, massPath } = await startWithInvalidMass();
    const copyError = new Error("recovery copy failed");
    const copySpy = jest.spyOn(fs, "cpSync").mockImplementationOnce(() => {
      throw copyError;
    });
    try {
      const response = await request(handle.app).post("/api/new-mass").send({ title: "Next Mass" });
      expect(response.status).toBe(500);
      expect(fs.readFileSync(massPath, "utf8")).toBe("{not json");
      expect(fs.readFileSync(path.join(path.dirname(massPath), "Gospel.txt"), "utf8"))
        .toBe("John 1:1\n\nIn the beginning");
      expect(fs.readFileSync(path.join(path.dirname(massPath), "assets", "photo.png"), "utf8"))
        .toBe("asset bytes");
    } finally {
      copySpy.mockRestore();
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
