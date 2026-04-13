describe("logger", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("suppresses info logs when quiet mode is enabled", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const logger = require("../../src/logger");

    logger.setQuietLogs(true);
    logger.info("hello");

    expect(logSpy).not.toHaveBeenCalled();
  });

  test("warn and error still write when quiet mode is enabled", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const logger = require("../../src/logger");

    logger.setQuietLogs(true);
    logger.warn("warn");
    logger.error("error");

    expect(warnSpy).toHaveBeenCalledWith("warn");
    expect(errorSpy).toHaveBeenCalledWith("error");
  });
});
