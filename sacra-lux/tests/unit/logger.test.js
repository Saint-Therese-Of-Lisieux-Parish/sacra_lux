const fs = require("fs");
const os = require("os");
const path = require("path");

describe("logger", () => {
  let logDirectory;

  beforeEach(() => {
    jest.resetModules();
    logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-logger-"));
  });

  afterEach(() => {
    fs.rmSync(logDirectory, { recursive: true, force: true });
  });

  test("reports quiet mode", () => {
    const logger = require("../../src/logger");

    expect(logger.isQuietLogs()).toBe(false);
    logger.setQuietLogs(true);
    expect(logger.isQuietLogs()).toBe(true);
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

  test("writes packaged warning logs with a timestamp and level", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = require("../../src/logger");

    logger.configure({ isPackaged: true, logDirectory });
    logger.warn("disk is full");

    const content = fs.readFileSync(path.join(logDirectory, "sacra-lux.log"), "utf8");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T[^ ]+ WARN disk is full\n$/);
    warnSpy.mockRestore();
  });

  test("rotates a packaged log before writing past 5 MiB", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = require("../../src/logger");
    const logPath = path.join(logDirectory, "sacra-lux.log");

    fs.writeFileSync(logPath, "x".repeat(5 * 1024 * 1024));
    logger.configure({ isPackaged: true, logDirectory });
    logger.warn("after rotation");

    expect(fs.statSync(`${logPath}.1`).size).toBe(5 * 1024 * 1024);
    expect(fs.readFileSync(logPath, "utf8")).toContain("WARN after rotation");
    warnSpy.mockRestore();
  });

  test("redacts secret-like values from packaged logs", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const logger = require("../../src/logger");

    logger.configure({ isPackaged: true, logDirectory });
    logger.warn("pin=123456 controlToken=secret-token Bearer abc123");

    const content = fs.readFileSync(path.join(logDirectory, "sacra-lux.log"), "utf8");
    expect(content).toContain("pin=[REDACTED]");
    expect(content).toContain("controlToken=[REDACTED]");
    expect(content).toContain("Bearer [REDACTED]");
    expect(content).not.toContain("123456");
    expect(content).not.toContain("secret-token");
    expect(content).not.toContain("abc123");
    warnSpy.mockRestore();
  });
});
