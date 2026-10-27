const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

describe("flushPendingSave", () => {
  test("writes a pending save once and does nothing when no save is pending", async () => {
    jest.resetModules();
    const saveSession = jest.fn();
    jest.doMock("../../src/persistence", () => ({
      ...jest.requireActual("../../src/persistence"),
      saveSession
    }));
    const handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-flush-")
    });
    const { flushPendingSave } = require("../../src/server");
    try {
      await request(handle.app).post("/api/update-title").send({ title: "Pending" }).expect(200);
      saveSession.mockClear();

      flushPendingSave();
      flushPendingSave();

      expect(saveSession).toHaveBeenCalledTimes(1);
    } finally {
      jest.dontMock("../../src/persistence");
      await handle.stop();
    }
  });

  test("logs a failed final save and returns", async () => {
    jest.resetModules();
    const syncCurrentMassToArchive = jest.fn(() => {
      throw new Error("ENOSPC: simulated");
    });
    jest.doMock("../../src/massHistory", () => ({
      ...jest.requireActual("../../src/massHistory"),
      syncCurrentMassToArchive
    }));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-flush-fail-")
    });
    const { flushPendingSave } = require("../../src/server");
    try {
      await request(handle.app).post("/api/update-title").send({ title: "Any" }).expect(200);

      expect(() => flushPendingSave()).not.toThrow();
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes("Save failed"))).toBe(true);
      const failedState = await request(handle.app).get("/api/state").expect(200);
      expect(failedState.body.saveError).toContain("mass.json");

      syncCurrentMassToArchive.mockReturnValue({ id: "archive-1" });
      await request(handle.app).post("/api/update-title").send({ title: "Recovered" }).expect(200);
      flushPendingSave();
      const recoveredState = await request(handle.app).get("/api/state").expect(200);
      expect(recoveredState.body.saveError).toBe("");
    } finally {
      errorSpy.mockRestore();
      jest.dontMock("../../src/massHistory");
      await handle.stop();
    }
  });
});
