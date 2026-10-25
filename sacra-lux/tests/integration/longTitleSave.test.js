const fs = require("fs");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The save timer debounces for 600 ms.
const SAVE_SETTLE_MS = 900;

describe("saving a Mass with a very long title", () => {
  afterEach(() => {
    jest.dontMock("../../src/massHistory");
  });

  test("creates a shortened archive folder and keeps running", async () => {
    jest.resetModules();
    const handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-long-title-")
    });
    try {
      await request(handle.app).post("/api/new-mass").send({ title: "Short", startTime: "" }).expect(200);
      await request(handle.app).post("/api/update-title").send({ title: "A".repeat(300) }).expect(200);
      await wait(SAVE_SETTLE_MS);

      const history = require("../../src/massHistory");
      const ids = fs.readdirSync(history.MASS_HISTORY_DIR);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(Buffer.byteLength(id, "utf8")).toBeLessThanOrEqual(255);
      }
      await request(handle.app).get("/api/state").expect(200);
    } finally {
      await handle.stop();
    }
  });

  test("logs a failed save and keeps running", async () => {
    jest.resetModules();
    jest.doMock("../../src/massHistory", () => ({
      ...jest.requireActual("../../src/massHistory"),
      syncCurrentMassToArchive: () => {
        throw new Error("ENAMETOOLONG: simulated");
      }
    }));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-save-fail-")
    });
    try {
      await request(handle.app).post("/api/update-title").send({ title: "Any" }).expect(200);
      await wait(SAVE_SETTLE_MS);

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("Save failed"))).toBe(true);
      await request(handle.app).get("/api/state").expect(200);
    } finally {
      errorSpy.mockRestore();
      await handle.stop();
    }
  });
});
