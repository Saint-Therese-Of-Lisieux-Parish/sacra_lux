const fs = require("fs");
const path = require("path");

const { createTempHome } = require("../helpers/testHarness");

describe("startup PIN reset", () => {
  const originalHome = process.env.HOME;
  const originalReset = process.env.SACRA_LUX_RESET_PIN;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalReset === undefined) delete process.env.SACRA_LUX_RESET_PIN;
    else process.env.SACRA_LUX_RESET_PIN = originalReset;
  });

  test("clears a saved PIN in web mode when enabled", async () => {
    const home = createTempHome("sacra-lux-pin-reset-");
    const configDir = path.join(home, ".sacra-lux");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "session.json"), JSON.stringify({
      startPinHash: { hash: "hash", salt: "salt", iterations: 1 },
      startPin: ""
    }));
    process.env.HOME = home;
    process.env.SACRA_LUX_RESET_PIN = "1";

    jest.resetModules();
    const logger = require("../../src/logger");
    const logSpy = jest.spyOn(logger, "info").mockImplementation(() => {});
    const { startServer } = require("../../src/server");
    const handle = startServer(0, { quietLogs: true });
    await new Promise((resolve, reject) => {
      handle.server.once("listening", resolve);
      handle.server.once("error", reject);
    });

    try {
      const session = JSON.parse(fs.readFileSync(path.join(configDir, "session.json"), "utf8"));
      expect(session.startPinHash).toBeNull();
      expect(logSpy).toHaveBeenCalledWith("[security] Start PIN reset at startup.");
    } finally {
      await handle.close();
      logSpy.mockRestore();
    }
  });
});
