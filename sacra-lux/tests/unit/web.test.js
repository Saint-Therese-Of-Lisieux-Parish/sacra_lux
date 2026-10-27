const { EventEmitter } = require("events");
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
    const startServer = jest.fn(() => ({ server: new EventEmitter() }));
    process.env.PORT = "19555";

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(19555);
  });

  test("falls back to the default port when PORT is unset", () => {
    const startServer = jest.fn(() => ({ server: new EventEmitter() }));

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(17841);
  });

  test("does not write the banner when stdout is not a terminal", () => {
    const startServer = jest.fn(() => ({ server: new EventEmitter() }));
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.stdout.isTTY = false;

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(17841);
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("writes the banner before the server starts when stdout is a terminal", () => {
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    const events = [];
    jest.spyOn(console, "log").mockImplementation((message) => {
      events.push(String(message));
    });
    const startServer = jest.fn(() => {
      events.push("server-start");
      return { server: new EventEmitter() };
    });
    process.stdout.isTTY = true;

    jest.doMock("../../src/server", () => ({ startServer }));

    try {
      require("../../src/web");

      const visible = (entry) => entry.replace(/\u001b\[[0-9;]*m/g, "");
      const bannerIndex = events.findIndex((entry) => visible(entry).includes("___   _   ___ ___"));
      expect(bannerIndex).toBeGreaterThanOrEqual(0);
      expect(events[bannerIndex]).toMatch(/\u001b\[38;5;/);
      expect(visible(events[bannerIndex])).toContain(pkg.version);
      expect(events.indexOf("server-start")).toBeGreaterThan(bannerIndex);
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
  });

  test("does not write the banner when quiet logs are on", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const startServer = jest.fn(() => ({ server: new EventEmitter() }));
    process.stdout.isTTY = true;
    const logger = require("../../src/logger");
    logger.setQuietLogs(true);

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(logSpy).not.toHaveBeenCalled();
    expect(startServer).toHaveBeenCalledWith(17841);
  });

  test("prints a plain message and exits 1 when the port is in use", () => {
    const server = new EventEmitter();
    const startServer = jest.fn(() => ({ server }));
    const writeSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
    process.env.PORT = "19555";

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");
    server.emit("error", Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }));

    expect(writeSpy.mock.calls[0][0]).toContain("19555");
    expect(writeSpy.mock.calls[0][0]).toContain("PORT");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("prints the message and exits 1 for another listen error", () => {
    const server = new EventEmitter();
    const startServer = jest.fn(() => ({ server }));
    const writeSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");
    server.emit("error", Object.assign(new Error("permission denied"), { code: "EACCES" }));

    expect(writeSpy.mock.calls[0][0]).toContain("permission denied");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
