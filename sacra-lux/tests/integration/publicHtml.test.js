const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("public html integration", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-public-html-")
    });
    app = handle.app;
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  test("operator app markup exposes accessible command labels and safe external links", async () => {
    const res = await request(app).get("/").expect(200);

    expect(res.text).toContain('id="massTitleInput"');
    expect(res.text).toContain('aria-label="Mass title"');
    expect(res.text).toContain('<label for="startTimeInput"');
    expect(res.text).toContain('target="_blank" rel="noopener noreferrer"');
  });

  test("start page markup includes a PIN label and live error region", async () => {
    const res = await request(app).get("/start").expect(200);

    expect(res.text).toContain('<label for="pinInput" class="sr-only">PIN Code</label>');
    expect(res.text).toContain('id="errorMsg" class="error-msg" role="status" aria-live="polite"');
  });
});
