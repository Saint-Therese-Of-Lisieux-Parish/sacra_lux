const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeFileAtomic } = require("../../src/atomicWrite");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-atomic-"));
}

function tempFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.includes(".tmp-"));
}

describe("atomic file writes", () => {
  test("writes the destination and leaves no temporary file", () => {
    const dir = tempDir();
    const target = path.join(dir, "session.json");

    writeFileAtomic(target, "{\"ok\":true}");

    expect(fs.readFileSync(target, "utf8")).toBe("{\"ok\":true}");
    expect(tempFiles(dir)).toEqual([]);
  });

  test("flushes the temporary file and replaces the destination with a rename", () => {
    const dir = tempDir();
    const target = path.join(dir, "reading.txt");
    const fsyncSpy = jest.spyOn(fs, "fsyncSync");
    const renameSpy = jest.spyOn(fs, "renameSync");

    writeFileAtomic(target, "text");

    expect(fsyncSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(tempFiles(dir)).toEqual([]);
  });

  test("keeps the prior file when the rename fails and removes the temporary file", () => {
    const dir = tempDir();
    const target = path.join(dir, "reading.txt");
    fs.writeFileSync(target, "prior", "utf8");

    const realRename = fs.renameSync;
    jest.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename failed");
    });

    expect(() => writeFileAtomic(target, "next")).toThrow("rename failed");
    expect(fs.readFileSync(target, "utf8")).toBe("prior");
    expect(tempFiles(dir)).toEqual([]);

    expect(realRename).toBeDefined();
  });

  test("removes the temporary file when writing fails", () => {
    const dir = tempDir();
    const target = path.join(dir, "reading.txt");
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("write failed");
    });

    expect(() => writeFileAtomic(target, "next")).toThrow("write failed");
    expect(tempFiles(dir)).toEqual([]);
  });

  test("copies the prior file to a backup before replacing it", () => {
    const dir = tempDir();
    const target = path.join(dir, "session.json");
    fs.writeFileSync(target, "prior", "utf8");

    writeFileAtomic(target, "next", { keepBackup: true });

    expect(fs.readFileSync(target, "utf8")).toBe("next");
    expect(fs.readFileSync(`${target}.bak`, "utf8")).toBe("prior");
    expect(tempFiles(dir)).toEqual([]);
  });
});
