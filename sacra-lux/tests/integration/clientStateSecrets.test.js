const os = require("os");
const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

// Key names that must never reach a client at any depth. Compared case-insensitively.
const DENIED_KEY = /^(pin|pinhash|startpin|startpinhash|token|starttoken|session|sessionid|secret|password)$/i;

// Names that look like secrets but only report a yes/no value. Each needs a reason.
const ALLOWED_KEYS = new Set([
  // Boolean that tells the UI a PIN exists. It never holds the PIN.
  "hasStartPin"
]);

const ABSOLUTE_PATH = /(^|[\s"'=(])(\/(?:Users|home|var|tmp|private|etc|opt)\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/;

function collectKeys(value, trail = [], found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectKeys(item, [...trail, String(index)], found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push({ key, path: [...trail, key].join(".") });
      collectKeys(child, [...trail, key], found);
    }
  }
  return found;
}

function deniedKeyPaths(snapshot) {
  return collectKeys(snapshot)
    .filter(({ key }) => DENIED_KEY.test(key) && !ALLOWED_KEYS.has(key))
    .map(({ path }) => path);
}

describe("client state has no secrets or paths", () => {
  const PIN = "482916";
  let handle;
  let app;
  let state;
  let security;
  let getStateSnapshot;
  let secrets;
  let controlToken;

  function expectClean(snapshot, extraSecrets = []) {
    const json = JSON.stringify(snapshot);
    expect(deniedKeyPaths(snapshot)).toEqual([]);
    for (const secret of [...secrets, ...extraSecrets]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain(handle.homeDir);
    expect(json).not.toContain(os.homedir());
    expect(json).not.toMatch(ABSOLUTE_PATH);
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-secrets-") });
    app = handle.app;
    ({ state, getStateSnapshot } = require("../../src/state"));
    security = require("../../src/security");
  });

  beforeEach(async () => {
    security.resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    state.controlMode = "unset";
    const pinResponse = await request(app).post("/api/start-pin").send({ pin: PIN }).expect(200);
    controlToken = pinResponse.body.controlToken;
    const startToken = security.issueStartToken({ ip: "127.0.0.1", userAgent: "jest" });
    secrets = [PIN, state.startPinHash.hash, state.startPinHash.salt, startToken, controlToken]
      .filter((value) => typeof value === "string" && value.length >= 6);
    expect(secrets.length).toBeGreaterThanOrEqual(4);
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("snapshot omits the PIN, hash, token, and absolute paths (R1, R3)", () => {
    expect(state.startPinHash).toBeTruthy();
    const snapshot = getStateSnapshot();
    expect(snapshot.hasStartPin).toBe(true);
    expectClean(snapshot);
  });

  test("snapshot omits the Mass folder path but keeps a loaded flag (R1, R2)", () => {
    const previous = state.readingsSource;
    state.readingsSource = { folderPath: "/var/folders/xx/T/sacra-lux/.sacra-lux/current_mass", documents: [] };
    try {
      const snapshot = getStateSnapshot();
      expect(snapshot.readingsSource.folderPath).toBeUndefined();
      expect(snapshot.readingsSource.hasFolder).toBe(true);
      expectClean(snapshot);
    } finally {
      state.readingsSource = previous;
    }
  });

  test("snapshot omits a legacy plain PIN (R1)", () => {
    state.startPin = PIN;
    try {
      expectClean(getStateSnapshot());
    } finally {
      state.startPin = "";
    }
  });

  test("deny list walks nested keys and arrays (R4)", () => {
    expect(deniedKeyPaths({ a: [{ b: { pinHash: "x" } }], hasStartPin: true }))
      .toEqual(["a.0.b.pinHash"]);
    expect(deniedKeyPaths({ nested: { Token: 1 }, Session: 2 }))
      .toEqual(["nested.Token", "Session"]);
  });

  test("every client role receives clean state:update payloads (R2)", async () => {
    const roles = ["operator", "screen", "remote"];
    const sockets = await Promise.all(roles.map(async () => {
      const socket = createClient(handle.baseUrl, { transports: ["websocket"] });
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    }));

    try {
      const payloads = sockets.map((socket) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for state:update")), 3000);
        socket.once("state:update", (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      }));
      await request(app).post("/api/new-mass").set("x-sacra-control", controlToken).send({ title: "Secrets Mass", startTime: "" }).expect(200);
      const received = await Promise.all(payloads);
      expect(received).toHaveLength(roles.length);
      received.forEach((payload) => expectClean(payload));
    } finally {
      sockets.forEach((socket) => socket.disconnect());
    }
  });
});
