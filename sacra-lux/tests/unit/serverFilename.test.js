const { buildUploadedAssetFilename } = require("../../src/server");

describe("buildUploadedAssetFilename", () => {
  test("cleans a long trailing-dot filename in linear time", () => {
    const filename = `${".".repeat(100000)}.txt`;
    const startedAt = process.hrtime.bigint();

    expect(buildUploadedAssetFilename(filename, "png", "/tmp/missing-assets")).toBe("light.png");

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    expect(elapsedMs).toBeLessThan(50);
  });
});
