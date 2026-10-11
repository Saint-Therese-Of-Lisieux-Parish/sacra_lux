const pkg = require("../../package.json");

describe("web entry point", () => {
  const originalPort = process.env.PORT;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.PORT;
    process.stdout.isTTY = false;
  });

  afterAll(() => {
    process.stdout.isTTY = originalIsTTY;
    if (originalPort === undefined) {
      delete process.env.PORT;
      return;
    }
    process.env.PORT = originalPort;
  });

  test("starts the server on the configured PORT", () => {
    const startServer = jest.fn();
    process.env.PORT = "19555";

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(19555);
  });

  test("falls back to the default port when PORT is unset", () => {
    const startServer = jest.fn();

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(17841);
  });

  test("does not write the banner when stdout is not a terminal", () => {
    const startServer = jest.fn();
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.stdout.isTTY = false;

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(17841);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("writes the banner before the server starts when stdout is a terminal", () => {
    const events = [];
    jest.spyOn(console, "log").mockImplementation((message) => {
      events.push(String(message));
    });
    const startServer = jest.fn(() => {
      events.push("server-start");
    });
    process.stdout.isTTY = true;

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    const bannerIndex = events.findIndex((entry) => entry.includes("___   _   ___ ___"));
    expect(bannerIndex).toBeGreaterThanOrEqual(0);
    expect(events[bannerIndex]).toContain(pkg.version);
    expect(events.indexOf("server-start")).toBeGreaterThan(bannerIndex);
  });

  test("does not write the banner when quiet logs are on", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const startServer = jest.fn();
    process.stdout.isTTY = true;
    const logger = require("../../src/logger");
    logger.setQuietLogs(true);

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(logSpy).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledWith(17841);
  });
});
