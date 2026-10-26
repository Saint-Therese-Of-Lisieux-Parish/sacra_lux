const http = require("http");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

// Every state-changing route is checked, so a new route is covered by the middleware order.
const STATE_CHANGING_ROUTES = [
  ["post", "/api/screen-settings", { fontSizePx: 99 }],
  ["post", "/api/update-title", { title: "Evil title" }],
  ["post", "/api/control-mode", { mode: "trusted-lan" }],
  ["post", "/api/verify-pin", { pin: "0000" }]
];

describe("Host and Origin guard", () => {
  let handle;
  let port;

  beforeAll(async () => {
    jest.resetModules();
    process.env.SACRA_LUX_ALLOWED_NETWORKS = "10.12.0.0/21";
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-host-guard-") });
    port = handle.server.address().port;
  });

  afterAll(async () => {
    delete process.env.SACRA_LUX_ALLOWED_NETWORKS;
    if (handle) await handle.stop();
  });

  // supertest cannot set a Host header that differs from the socket, so use http directly.
  function rawRequest({ method = "GET", path = "/api/state", headers = {} }) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
  }

  test.each(STATE_CHANGING_ROUTES)("R1: %s %s with a foreign Origin returns 403", async (method, route, body) => {
    const before = JSON.stringify((await request(handle.app).get("/api/state")).body.screenSettings);

    const res = await request(handle.app)[method](route).set("Origin", "https://evil.example").send(body);

    expect(res.status).toBe(403);
    const after = JSON.stringify((await request(handle.app).get("/api/state")).body.screenSettings);
    expect(after).toBe(before);
  });

  test("R3: a POST with Sec-Fetch-Site cross-site returns 403", async () => {
    const res = await request(handle.app)
      .post("/api/update-title")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ title: "Evil title" });
    expect(res.status).toBe(403);
  });

  test("R3: a POST with Sec-Fetch-Site same-origin is not blocked by the site check", async () => {
    const res = await request(handle.app)
      .post("/api/update-title")
      .set("Sec-Fetch-Site", "same-origin")
      .send({ title: "Fine title" });
    expect(res.status).not.toBe(403);
  });

  test("R2: a socket handshake with a foreign Origin fails", async () => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Origin: "https://evil.example" }
    });
    const outcome = await new Promise((resolve) => {
      client.on("connect", () => resolve("connected"));
      client.on("connect_error", () => resolve("rejected"));
    });
    client.close();
    expect(outcome).toBe("rejected");
  });

  test("R2: a socket handshake with no Origin connects", async () => {
    const client = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false });
    const outcome = await new Promise((resolve) => {
      client.on("connect", () => resolve("connected"));
      client.on("connect_error", () => resolve("rejected"));
    });
    client.close();
    expect(outcome).toBe("connected");
  });

  test("R3: a foreign Host returns 403", async () => {
    expect(await rawRequest({ headers: { Host: "evil.example" } })).toBe(403);
    expect(await rawRequest({ path: "/", headers: { Host: "evil.example:80" } })).toBe(403);
  });

  test("R4: a request with no Origin works", async () => {
    await request(handle.app).get("/api/state").expect(200);
    await request(handle.app).post("/api/verify-pin").send({ pin: "0000" }).expect((res) => {
      expect(res.status).not.toBe(403);
    });
  });

  test.each([
    "localhost:17841",
    "127.0.0.1:17841",
    "[::1]:17841",
    "10.12.3.4:17841"
  ])("R5: Host %s is accepted", async (host) => {
    expect(await rawRequest({ headers: { Host: host } })).toBe(200);
  });

  test("R5: a local Origin is accepted on a state-changing request", async () => {
    const res = await request(handle.app).post("/api/verify-pin").set("Origin", "http://10.12.3.4:17841").send({ pin: "0000" });
    expect(res.status).not.toBe(403);
  });

  test("a host outside the configured network is rejected", async () => {
    expect(await rawRequest({ headers: { Host: "10.12.8.1:17841" } })).toBe(403);
  });
});
