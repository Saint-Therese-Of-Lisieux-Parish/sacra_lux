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
});
