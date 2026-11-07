const crypto = require("crypto");
const http = require("http");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const MIB = 1024 * 1024;

function parseBuffer(res, callback) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("Mass ZIP round trip with a large movie", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-large-zip-") });
    app = handle.app;
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("a Mass with a 60 MiB movie imports again from its own export", async () => {
    await request(app).post("/api/new-mass").send({ title: "Big Movie", startTime: "" }).expect(200);
    // Random bytes do not compress, like a real movie file.
    const movie = crypto.randomBytes(60 * MIB);
    const upload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "big.mp4", dataUrl: `data:video/mp4;base64,${movie.toString("base64")}` })
      .expect(200);
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{ id: "movie-1", type: "movie", label: "Movie", phase: "pre", backgroundTheme: "dark" }],
        manualSlides: { "movie-1": { videoUrl: upload.body.url } }
      })
      .expect(200);

    const exported = await request(app).get("/api/export-mass-zip").buffer(true).parse(parseBuffer).expect(200);
    expect(exported.body.length).toBeGreaterThan(50 * MIB);

    await request(app)
      .post("/api/import-mass-zip")
      .send({ zipData: exported.body.toString("base64") })
      .expect(200);
    const served = await request(app).get(upload.body.url).buffer(true).parse(parseBuffer).expect(200);
    expect(served.body.length).toBe(movie.length);
  }, 120000);

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
