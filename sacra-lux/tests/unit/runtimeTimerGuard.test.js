const fs = require("fs");
const path = require("path");

const serverSource = fs.readFileSync(path.join(__dirname, "../../src/server.js"), "utf8");

describe("runtime timer guards", () => {
  test("logs timer errors without rethrowing them", () => {
    jest.resetModules();
    const logger = require("../../src/logger");
    const { safeTimerCallback } = require("../../src/server");
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});

    expect(safeTimerCallback("testTimer", () => {
      throw new Error("simulated failure");
    })()).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("[timer] testTimer failed: simulated failure");

    errorSpy.mockRestore();
  });

  test("passes server timer callbacks through the timer guard", () => {
    const timerLines = serverSource
      .split("\n")
      .filter((line) => line.includes("setTimeout(") || line.includes("setInterval("));
    const allowedLines = timerLines.filter((line) =>
      line.includes("setTimeout(runScheduledSave") ||
      line.includes("setTimeout(() => avifDownloadTokens.delete")
    );

    expect(timerLines.filter((line) => !allowedLines.includes(line)).every((line) =>
      line.includes("safeTimerCallback(")
    )).toBe(true);
  });
});
