const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

describe("remote control session management", () => {
  let handle;
  let security;
  let state;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-control-sessions-") });
    security = require("../../src/security");
    ({ state } = require("../../src/state"));
    state.startPinHash = security.createPinHashRecord("123456");
    state.presentation.slides = [{ id: "mass-slide", phase: "mass", type: "text", text: "Mass" }];
    state.currentSlideIndex = 0;
    security.resetSecurityState();
  });

  afterAll(async () => {
    state.startPinHash = null;
    security.resetSecurityState();
    await handle.stop();
  });

  function connect(token) {
    return new Promise((resolve, reject) => {
      const client = createClient(handle.baseUrl, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
        auth: { token }
      });
      client.once("connect", () => resolve(client));
      client.once("connect_error", reject);
    });
  }

  function nextRequired(socket) {
    return new Promise((resolve) => socket.once("control:required", resolve));
  }

  test("ends all remote sessions but keeps the operator session", async () => {
    const operatorToken = security.noteControlUnlock();
    const remoteTokens = [security.noteControlUnlock(), security.noteControlUnlock()];
    const remotes = await Promise.all(remoteTokens.map(connect));
    const required = Promise.all(remotes.map(nextRequired));

    await request(handle.app)
      .post("/api/control-sessions/end")
      .set("X-Sacra-Control", operatorToken)
      .expect(200);
    await required;

    await request(handle.app)
      .post("/api/gathering/start")
      .set("X-Sacra-Control", remoteTokens[0])
      .expect(401);
    await request(handle.app)
      .post("/api/gathering/start")
      .set("X-Sacra-Control", operatorToken)
      .expect(200);
    remotes.forEach((socket) => socket.disconnect());
  });

  test("locks one remote and keeps other sessions valid", async () => {
    const lockedToken = security.noteControlUnlock();
    const otherToken = security.noteControlUnlock();
    const locked = await connect(lockedToken);
    const other = await connect(otherToken);
    const required = nextRequired(locked);
    locked.emit("control:lock");
    await required;

    await request(handle.app)
      .post("/api/gathering/start")
      .set("X-Sacra-Control", lockedToken)
      .expect(401);
    await request(handle.app)
      .post("/api/gathering/start")
      .set("X-Sacra-Control", otherToken)
      .expect(200);
    locked.disconnect();
    other.disconnect();
  });
});
