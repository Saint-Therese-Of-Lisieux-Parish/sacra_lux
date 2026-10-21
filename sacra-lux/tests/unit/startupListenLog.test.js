const fs = require("fs");
const os = require("os");
const path = require("path");

describe("server listen log", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
    jest.resetModules();
  });

  test("writes the listen address and the three URLs", async () => {
    const logs = [];
    jest.spyOn(console, "log").mockImplementation((message) => {
      logs.push(String(message));
    });

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-banner-"));
    process.env.HOME = homeDir;
    jest.resetModules();
    jest.doMock("os", () => {
      const actual = jest.requireActual("os");
      return {
        ...actual,
        homedir: () => homeDir
      };
    });

    let handle;
    try {
      const { getSessionFilePath } = require("../../src/persistence");
      expect(getSessionFilePath().startsWith(homeDir)).toBe(true);

      const { startServer } = require("../../src/server");
      handle = startServer(0, { quietLogs: false });
      await new Promise((resolve, reject) => {
        handle.server.once("listening", resolve);
        handle.server.once("error", reject);
      });

      const text = logs.join("\n");
      expect(text).toMatch(/Sacra Lux server listening on 0\.0\.0\.0:\d+/);
      expect(text).toMatch(/Sacra Lux URL: http:\/\/\S+\/app/);
      expect(text).toMatch(/Remote:\s+http:\/\/\S+\/remote/);
      expect(text).toMatch(/Screen URL:\s+http:\/\/\S+\/screen/);
      expect(text).not.toContain("___   _   ___ ___");
    } finally {
      if (handle) {
        await handle.close();
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
