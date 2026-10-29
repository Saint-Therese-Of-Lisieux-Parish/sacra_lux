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

  test("listMassArchives lists an archive with a damaged metadata.json by folder name", () => {
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    for (const id of ["Alpha", "Old", "Omega"]) {
      fs.mkdirSync(path.join(historyDir, id), { recursive: true });
      fs.writeFileSync(
        path.join(historyDir, id, "metadata.json"),
        id === "Old" ? '{"id":"Old",' : JSON.stringify({ id, title: `${id} title` }),
        "utf8"
      );
    }
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const history = require("../../src/massHistory");
    const listed = history.listMassArchives(null);

    expect(listed.map((a) => a.id).sort()).toEqual(["Alpha", "Old", "Omega"]);
    expect(listed.find((a) => a.id === "Old").title).toBe("Old");
    expect(listed.find((a) => a.id === "Alpha").title).toBe("Alpha title");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Old");
    warn.mockRestore();
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

  test("keeps unchanged media modification times during a sync", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(path.join(currentMassDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "current", "utf8");
    fs.writeFileSync(path.join(currentMassDir, "assets", "movie.mp4"), "movie", "utf8");

    const history = require("../../src/massHistory");
    const first = history.syncCurrentMassToArchive({ currentArchiveId: null, title: "Mass", startTime: null });
    const mediaPath = path.join(history.getArchivePaths(first.id).packageDir, "assets", "movie.mp4");
    const originalMtime = fs.statSync(mediaPath).mtimeMs;
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "updated", "utf8");

    history.syncCurrentMassToArchive({ currentArchiveId: first.id, title: "Mass", startTime: null });

    expect(fs.statSync(mediaPath).mtimeMs).toBe(originalMtime);
  });

  test("removes files that no longer exist in the current Mass", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(path.join(currentMassDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "current", "utf8");
    fs.writeFileSync(path.join(currentMassDir, "assets", "old.mp4"), "old", "utf8");

    const history = require("../../src/massHistory");
    const first = history.syncCurrentMassToArchive({ currentArchiveId: null, title: "Mass", startTime: null });
    fs.rmSync(path.join(currentMassDir, "assets", "old.mp4"));

    history.syncCurrentMassToArchive({ currentArchiveId: first.id, title: "Mass", startTime: null });

    expect(fs.existsSync(path.join(history.getArchivePaths(first.id).packageDir, "assets", "old.mp4"))).toBe(false);
  });

  test("keeps the previous package when a file copy fails", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({ title: "old" }), "utf8");

    const history = require("../../src/massHistory");
    const first = history.syncCurrentMassToArchive({ currentArchiveId: null, title: "Mass", startTime: null });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), JSON.stringify({ title: "new" }), "utf8");
    jest.spyOn(fs, "copyFileSync").mockImplementationOnce(() => {
      throw new Error("copy failed");
    });

    expect(() => history.syncCurrentMassToArchive({ currentArchiveId: first.id, title: "Mass", startTime: null }))
      .toThrow("copy failed");
    const archivedMass = JSON.parse(fs.readFileSync(path.join(history.getArchivePaths(first.id).packageDir, "mass.json"), "utf8"));
    expect(archivedMass.title).toBe("old");
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

  test("allocates a new ID when an existing archive differs only by case", () => {
    const historyDir = path.join(homeDir, ".sacra-lux", "mass_history");
    fs.mkdirSync(path.join(historyDir, "Sunday-Mass"), { recursive: true });

    const history = require("../../src/massHistory");

    expect(history.ensureActiveArchive({ currentArchiveId: null, title: "sunday mass", startTime: null }).archiveId)
      .toBe("sunday-mass-2");
  });

  test("keeps the active archive when only the title case changes", () => {
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    fs.mkdirSync(currentMassDir, { recursive: true });
    fs.writeFileSync(path.join(currentMassDir, "mass.json"), "current", "utf8");
    const history = require("../../src/massHistory");
    const first = history.syncCurrentMassToArchive({ currentArchiveId: null, title: "Sunday Mass", startTime: null });

    const second = history.syncCurrentMassToArchive({
      currentArchiveId: first.id,
      title: "sunday mass",
      startTime: null
    });

    expect(second.id).toBe(first.id);
    expect(history.listMassArchives().map((archive) => archive.id)).toEqual(["Sunday-Mass"]);
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
