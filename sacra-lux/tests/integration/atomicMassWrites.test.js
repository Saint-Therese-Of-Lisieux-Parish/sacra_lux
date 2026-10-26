const fs = require("fs");
const path = require("path");

const {
  createTempHome,
  loadReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("atomic Mass file writes", () => {
  let handle;
  let app;
  let server;
  let massDir;

  function failRenameTo(fileName) {
    const realRename = fs.renameSync.bind(fs);
    return jest.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (path.basename(String(to)) === fileName) throw new Error("disk full");
      return realRename(from, to);
    });
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-atomic-mass-") });
    app = handle.app;
    server = require("../../src/server");
    massDir = path.join(handle.homeDir, ".sacra-lux", "current_mass");
    const folder = path.join(handle.homeDir, "readings");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning.", "utf8");
    fs.writeFileSync(path.join(folder, "Gospel.txt"), "John 1:1\n\nIn the beginning was the Word.", "utf8");
    await loadReadingsFolder(app, folder);
    server.saveCurrentMass();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await handle.stop();
  });

  test("a failed mass.json write keeps the old valid file", () => {
    const before = fs.readFileSync(path.join(massDir, "mass.json"), "utf8");
    failRenameTo("mass.json");
    expect(() => server.saveCurrentMass()).toThrow("disk full");
    expect(fs.readFileSync(path.join(massDir, "mass.json"), "utf8")).toBe(before);
    expect(() => JSON.parse(before)).not.toThrow();
  });

  test("a failed metadata.json write keeps the old valid file", () => {
    const { metadataPath } = require("../../src/massHistory").getArchivePaths(
      require("../../src/state").state.activeMassArchiveId
    );
    const before = fs.readFileSync(metadataPath, "utf8");
    failRenameTo("metadata.json");
    expect(() => server.saveCurrentMass()).toThrow("disk full");
    expect(fs.readFileSync(metadataPath, "utf8")).toBe(before);
    expect(() => JSON.parse(before)).not.toThrow();
  });

  test("a failed reading write keeps the reading files that existed", () => {
    const gospel = path.join(massDir, "Gospel.txt");
    const readingI = path.join(massDir, "Reading_I.txt");
    const beforeGospel = fs.readFileSync(gospel, "utf8");
    const beforeReading = fs.readFileSync(readingI, "utf8");
    failRenameTo("Reading_I.txt");
    expect(() => server.saveCurrentMass()).toThrow("disk full");
    expect(fs.readFileSync(gospel, "utf8")).toBe(beforeGospel);
    expect(fs.readFileSync(readingI, "utf8")).toBe(beforeReading);
  });
});
