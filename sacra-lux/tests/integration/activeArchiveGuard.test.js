const fs = require("fs");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("active Mass archive guard", () => {
  let handle;
  let app;
  let massHistory;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-active-archive-") });
    app = handle.app;
    massHistory = require("../../src/massHistory");
    await request(app).post("/api/new-mass").send({ title: "Mass B", startTime: "2026-04-01T09:00" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
  });

  afterAll(async () => {
    await handle.stop();
  });

  test.each(["Mass%20B", "Mass-B*", "Mass-B%3F"])("DELETE %s does not delete the active archive", async (id) => {
    const { archiveDir } = massHistory.getArchivePaths("Mass-B");
    expect(fs.existsSync(archiveDir)).toBe(true);
    const response = await request(app).delete(`/api/mass-history/${id}`);
    expect(response.status).toBe(400);
    expect(fs.existsSync(archiveDir)).toBe(true);
  });

  test("compress with a cleaned-up ID does not change the active archive", async () => {
    const { packageDir } = massHistory.getArchivePaths("Mass-B");
    expect(fs.existsSync(packageDir)).toBe(true);
    const response = await request(app).post("/api/mass-history/Mass%20B/compress");
    expect(response.status).toBe(400);
    expect(fs.existsSync(packageDir)).toBe(true);
  });

  test("rejects delete and compress for an active title with a trailing period", async () => {
    await request(app).post("/api/new-mass").send({ title: "Mass C.", startTime: "2026-04-02T09:00" }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const archive = massHistory.getArchivePaths("Mass-C");
    expect(fs.existsSync(archive.archiveDir)).toBe(true);

    await expect(request(app).delete("/api/mass-history/Mass-C")).resolves.toMatchObject({ status: 400 });
    await expect(request(app).post("/api/mass-history/Mass-C/compress")).resolves.toMatchObject({ status: 400 });
    expect(fs.existsSync(archive.archiveDir)).toBe(true);
  });
});
