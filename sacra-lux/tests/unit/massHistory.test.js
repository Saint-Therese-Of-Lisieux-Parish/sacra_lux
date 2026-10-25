const fs = require("fs");
const path = require("path");

const { createTempHome } = require("../helpers/testHarness");

describe("massHistory", () => {
  let homeDir;

  beforeEach(() => {
    jest.resetModules();
    homeDir = createTempHome("sacra-lux-history-");
    process.env.HOME = homeDir;
  });

  test("syncCurrentMassToArchive creates and lists a title-based archive", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass_title.txt"), "Palm Sunday", "utf8");
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({ presentationTitle: "Palm Sunday" }), "utf8");

    const history = require("../../src/massHistory");
    const archive = history.syncCurrentMassToArchive({
      currentArchiveId: null,
      title: "Palm Sunday",
      startTime: "2026-03-29T10:00"
    });

    expect(archive.id).toBe("Palm-Sunday");
    const listed = history.listMassArchives(archive.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("Palm-Sunday");
    expect(listed[0].isActive).toBe(true);
    expect(listed[0].storage).toBe("folder");
    expect(listed[0].sizeBytes).toBeGreaterThan(0);
  });

  test("syncCurrentMassToArchive shortens an archive id for a very long title", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({ presentationTitle: "x" }), "utf8");

    const history = require("../../src/massHistory");
    const longTitle = "Long title \u00e9 ".repeat(40);
    const archive = history.syncCurrentMassToArchive({
      currentArchiveId: null,
      title: longTitle,
      startTime: "2026-03-29T10:00"
    });

    expect(Buffer.byteLength(archive.id, "utf8")).toBeLessThanOrEqual(200);
    expect(archive.id.startsWith("Long-title")).toBe(true);
    expect(fs.existsSync(path.join(history.MASS_HISTORY_DIR, archive.id))).toBe(true);
  });

  test("syncCurrentMassToArchive renames the active archive when the title changes", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({ presentationTitle: "Mass A" }), "utf8");

    const history = require("../../src/massHistory");
    const first = history.syncCurrentMassToArchive({
      currentArchiveId: null,
      title: "Mass A",
      startTime: null
    });
    const second = history.syncCurrentMassToArchive({
      currentArchiveId: first.id,
      title: "Mass B",
      startTime: null
    });

    expect(first.id).toBe("Mass-A");
    expect(second.id).toBe("Mass-B");
    expect(fs.existsSync(path.join(homeDir, ".sacra-lux", "mass_history", "Mass-A"))).toBe(false);
    expect(fs.existsSync(path.join(homeDir, ".sacra-lux", "mass_history", "Mass-B"))).toBe(true);
  });

  test("deleteMassArchive rejects ids that resolve outside mass_history", () => {
    const sacraDir = path.join(homeDir, ".sacra-lux");
    const canary = path.join(sacraDir, "canary.txt");
    fs.mkdirSync(sacraDir, { recursive: true });
    fs.writeFileSync(canary, "keep", "utf8");

    const history = require("../../src/massHistory");
    for (const archiveId of [".", "..", "../.."]) {
      expect(() => history.deleteMassArchive(archiveId)).toThrow("Invalid archive id.");
      expect(() => history.getArchivePaths(archiveId)).toThrow("Invalid archive id.");
    }

    expect(fs.existsSync(sacraDir)).toBe(true);
    expect(fs.readFileSync(canary, "utf8")).toBe("keep");
  });

  test("allocates the next available archive ID", () => {
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    fs.mkdirSync(path.join(historyDir, "Mass"), { recursive: true });
    fs.mkdirSync(path.join(historyDir, "Mass-2"), { recursive: true });

    const history = require("../../src/massHistory");
    expect(history.ensureActiveArchive({ currentArchiveId: null, title: "Mass", startTime: null }).archiveId)
      .toBe("Mass-3");
  });

  test("replaces a missing active archive and removes old package data", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "current", "utf8");
    fs.mkdirSync(path.join(historyDir, "Old", "package"), { recursive: true });
    fs.writeFileSync(path.join(historyDir, "Old", "package", "stale.txt"), "stale", "utf8");
    fs.writeFileSync(path.join(historyDir, "Old", "archive-avif.zip"), "zip", "utf8");

    const history = require("../../src/massHistory");
    const result = history.syncCurrentMassToArchive({
      currentArchiveId: "Old", title: "New", startTime: null
    });

    expect(result.id).toBe("New");
    expect(fs.existsSync(path.join(historyDir, "New", "package", "mass.json"))).toBe(true);
    expect(fs.existsSync(path.join(historyDir, "New", "archive-avif.zip"))).toBe(false);
  });

  test("keeps other archives and returns false for a missing archive", () => {
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    fs.mkdirSync(path.join(historyDir, "Good"), { recursive: true });
    const history = require("../../src/massHistory");

    expect(history.deleteMassArchive("Missing")).toBe(false);
    expect(history.deleteMassArchive("Good")).toBe(true);
    expect(fs.existsSync(historyDir)).toBe(true);
  });

  test("lists only archive folders and reads a damaged-free metadata fallback", () => {
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, "not-an-archive"), "file", "utf8");
    fs.mkdirSync(path.join(historyDir, "Folder"), { recursive: true });
    const history = require("../../src/massHistory");

    expect(history.listMassArchives().map((archive) => archive.id)).toEqual(["Folder"]);
  });

  test("rejects an archive name that sanitizes to an empty value", () => {
    const history = require("../../src/massHistory");

    expect(() => history.getArchivePaths("<>|?*")).toThrow("Invalid archive id.");
  });

  test("rejects an archive directory outside the history root", () => {
    const history = require("../../src/massHistory");
    const joinSpy = jest.spyOn(path, "join").mockImplementationOnce(() => history.MASS_HISTORY_DIR);

    expect(() => history.getArchivePaths("Safe")).toThrow("Invalid archive id.");
    joinSpy.mockRestore();
  });

  test("creates an empty package when the current Mass folder is missing", () => {
    const history = require("../../src/massHistory");

    const result = history.syncCurrentMassToArchive({
      currentArchiveId: null, title: "No Folder", startTime: null
    });

    expect(fs.existsSync(history.getArchivePaths(result.id).packageDir)).toBe(true);
  });

  test("removes a compressed archive when a folder archive replaces it", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "current", "utf8");
    const history = require("../../src/massHistory");
    const first = history.ensureActiveArchive({
      currentArchiveId: null, title: "Compressed", startTime: null
    });
    fs.writeFileSync(first.paths.compressedZipPath, "zip", "utf8");

    const result = history.syncCurrentMassToArchive({
      currentArchiveId: first.archiveId, title: "Compressed", startTime: null
    });

    expect(fs.existsSync(history.getArchivePaths(result.id).compressedZipPath)).toBe(false);
  });
});
