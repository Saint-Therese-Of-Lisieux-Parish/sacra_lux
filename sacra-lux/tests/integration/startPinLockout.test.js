const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("start PIN route lockout", () => {
  let handle;
  let app;
  let security;
  let state;

  beforeEach(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-pin-lock-") });
    app = handle.app;
    security = require("../../src/security");
    ({ state } = require("../../src/state"));
    security.resetSecurityState();
    await request(app).post("/api/start-pin").send({ pin: "4821" }).expect(200);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    security.resetSecurityState();
    await handle.stop();
  });

  async function lockOut(path, body) {
    for (let i = 0; i < 3; i += 1) {
      await request(app).post(path).send(body).expect(403);
    }
  }

  test("verify-pin lockout blocks a PIN change with the correct current PIN", async () => {
    await lockOut("/api/verify-pin", { pin: "0000" });
    const before = state.startPinHash;
    const response = await request(app).post("/api/start-pin").send({ currentPin: "4821", pin: "1111" });
    expect(response.status).toBe(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(state.startPinHash).toBe(before);
  });

  test("failed PIN changes lock out verify-pin", async () => {
    await lockOut("/api/start-pin", { currentPin: "0000", pin: "1111" });
    const response = await request(app).post("/api/verify-pin").send({ pin: "4821" });
    expect(response.status).toBe(429);
  });

  test("the PIN change works again after the lock expires", async () => {
    await lockOut("/api/verify-pin", { pin: "0000" });
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation(() => (
      /security\.js/.test(new Error().stack) ? realNow() + 2 * 60 * 1000 : realNow()
    ));
    await request(app).post("/api/start-pin").send({ currentPin: "4821", pin: "1111" }).expect(200);
  });
});
