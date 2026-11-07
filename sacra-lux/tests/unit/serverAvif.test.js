const { convertImageToAvif } = require("../../src/server");
const logger = require("../../src/logger");

describe("AVIF image conversion", () => {
  test("rejects a conversion that loses animation frames", async () => {
    const metadata = jest
      .fn()
      .mockResolvedValueOnce({ pages: 3 })
      .mockResolvedValueOnce({ pages: 1 });
    const toBuffer = jest.fn().mockResolvedValue(Buffer.from("avif"));
    const input = { metadata, avif: jest.fn(() => ({ toBuffer })) };
    const sharp = jest.fn()
      .mockReturnValueOnce(input)
      .mockReturnValueOnce({ metadata });

    await expect(convertImageToAvif(sharp, "/tmp/animated.gif")).resolves.toBeNull();
    expect(sharp).toHaveBeenNthCalledWith(1, "/tmp/animated.gif", { animated: true, pages: -1 });
  });

  test("returns a conversion that keeps all frames", async () => {
    const metadata = jest
      .fn()
      .mockResolvedValueOnce({ pages: 3 })
      .mockResolvedValueOnce({ pages: 3 });
    const toBuffer = jest.fn().mockResolvedValue(Buffer.from("avif"));
    const input = { metadata, avif: jest.fn(() => ({ toBuffer })) };
    const avif = Buffer.from("avif");
    const sharp = jest.fn()
      .mockReturnValueOnce(input)
      .mockReturnValueOnce({ metadata });

    await expect(convertImageToAvif(sharp, "/tmp/animated.gif")).resolves.toEqual(avif);
  });

  test("keeps the original when conversion fails and logs the file name", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const sharp = jest.fn().mockImplementation(() => {
      throw new Error("Input file contains unsupported image format");
    });

    await expect(convertImageToAvif(sharp, "/tmp/bad.jpg")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("AVIF conversion failed for bad.jpg.");

    warn.mockRestore();
  });
});
