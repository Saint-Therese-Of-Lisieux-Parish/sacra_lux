const http = require("http");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const MIB = 1024 * 1024;

describe("Mass ZIP round trip with a large movie", () => {
  let handle;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-large-zip-") });
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("an oversized request gets HTTP 400 that names the limit", async () => {
    const { MASS_ZIP_LIMITS } = require("../../src/server");
    const address = handle.server.address();
    // Stream a body past the request limit. The server answers before the body ends.
    const response = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: address.port,
        path: "/api/import-mass-zip",
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on("error", reject);
      const chunk = "A".repeat(MIB);
      const chunks = Math.ceil(MASS_ZIP_LIMITS.maxCompressedBytes * 1.4 / MIB);
      let sent = 0;
      req.write('{"zipData":"');
      const pump = () => {
        while (sent < chunks && !req.destroyed) {
          sent += 1;
          if (!req.write(chunk)) {
            req.once("drain", pump);
            return;
          }
        }
        req.end('"}');
      };
      pump();
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain(String(MASS_ZIP_LIMITS.maxCompressedBytes));
    expect(response.body.error).toMatch(/request is (at least )?\d+ bytes/);
  }, 60000);
});
