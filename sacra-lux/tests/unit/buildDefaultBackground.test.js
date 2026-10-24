const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const { buildDefaultBackground } = require("../../scripts/build-default-background");

describe("buildDefaultBackground", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-bg-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function writeSource() {
    const sourcePath = path.join(dir, "Sacra Lux Default Background HD.png");
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } })
      .png()
      .toFile(sourcePath);
    return sourcePath;
  }

  test("converts a clone to AVIF and leaves the source file in place", async () => {
    const sourcePath = await writeSource();
    const before = fs.readFileSync(sourcePath);
    const outputPath = path.join(dir, "out.avif");

    await buildDefaultBackground({ sourcePath, outputPath });

    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(fs.readFileSync(sourcePath).equals(before)).toBe(true);
    expect((await sharp(outputPath).metadata()).format).toBe("heif");
  });

  test("fails with a clear error when the source is missing", async () => {
    await expect(
      buildDefaultBackground({ sourcePath: path.join(dir, "missing.png"), outputPath: path.join(dir, "o.avif") })
    ).rejects.toThrow("Source image not found");
  });

  test("the committed default AVIF asset exists", () => {
    const assetPath = path.join(__dirname, "..", "..", "public", "assets", "default-text-background.avif");
    expect(fs.statSync(assetPath).size).toBeGreaterThan(0);
  });
});
