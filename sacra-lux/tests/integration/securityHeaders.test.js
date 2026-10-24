const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("HTTP security headers", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({
      port: 0,
      homeDir: createTempHome("sacra-lux-security-headers-")
    });
    app = handle.app;
  });

  afterAll(async () => {
    if (handle) {
      await handle.stop();
    }
  });

  test.each(["/", "/app", "/screen", "/remote", "/api/state", "/static/shared.css", "/missing-route"])(
    "%s sends X-Content-Type-Options nosniff",
    async (route) => {
      const res = await request(app).get(route);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
  );

  test.each(["/", "/app", "/screen", "/remote"])("%s sends CSP, referrer, and framing headers", async (route) => {
    const res = await request(app).get(route).expect(200);
    const csp = res.headers["content-security-policy"];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("API responses do not carry the page CSP", async () => {
    const res = await request(app).get("/api/state").expect(200);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});
