const fs = require("fs");
const path = require("path");
const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");
const { DEFAULT_SOURCE_NETWORKS } = require("../../src/state");
const { createSourceNetworkGuard } = require("../../src/hostGuard");

test("the default source network allowlist accepts RFC 1918 addresses and rejects public addresses", () => {
  const guard = createSourceNetworkGuard({ allowedEntries: DEFAULT_SOURCE_NETWORKS });

  expect(guard.isAllowedAddress("192.168.1.5")).toBe(true);
  expect(guard.isAllowedAddress("8.8.8.8")).toBe(false);
});

test("the environment allowlist rejects a private address outside the configured network", () => {
  const previous = process.env.SACRA_LUX_SOURCE_NETWORKS;
  process.env.SACRA_LUX_SOURCE_NETWORKS = "203.0.113.0/24";
  const guard = createSourceNetworkGuard();

  expect(guard.isAllowedAddress("10.12.0.63")).toBe(false);
  expect(guard.isAllowedAddress("203.0.113.10")).toBe(true);
  if (previous === undefined) delete process.env.SACRA_LUX_SOURCE_NETWORKS;
  else process.env.SACRA_LUX_SOURCE_NETWORKS = previous;
});

test("a saved source-network list overrides the environment list", () => {
  const previous = process.env.SACRA_LUX_SOURCE_NETWORKS;
  process.env.SACRA_LUX_SOURCE_NETWORKS = "203.0.113.0/24";
  const guard = createSourceNetworkGuard({ allowedEntries: "10.12.0.63/32" });

  expect(guard.isAllowedAddress("10.12.0.63")).toBe(true);
  expect(guard.isAllowedAddress("203.0.113.10")).toBe(false);
  if (previous === undefined) delete process.env.SACRA_LUX_SOURCE_NETWORKS;
  else process.env.SACRA_LUX_SOURCE_NETWORKS = previous;
});

describe("source-network guard loopback access", () => {
  let handle;
  let homeDir;

  beforeAll(async () => {
    jest.resetModules();
    homeDir = createTempHome("sacra-lux-source-network-");
    const dataDir = path.join(homeDir, ".sacra-lux");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "session.json"), JSON.stringify({
      version: 2,
      appSettings: { sourceNetworks: "192.0.2.10/32" }
    }));
    handle = await startIsolatedServer({ port: 0, homeDir });
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("accepts an HTTP request from loopback after restoring an allowlist", async () => {
    await request(handle.app).get("/api/state").expect(200);
  });

  test("accepts a Socket.IO handshake from loopback after restoring an allowlist", async () => {
    const client = createClient(handle.baseUrl, {
      transports: ["websocket"],
      reconnection: false
    });
    const stateUpdate = new Promise((resolve) => client.once("state:update", resolve));
    const outcome = await new Promise((resolve) => {
      client.once("connect", () => resolve("connected"));
      client.once("connect_error", () => resolve("rejected"));
    });
    const state = await Promise.race([
      stateUpdate,
      new Promise((resolve) => setTimeout(() => resolve(null), 1000))
    ]);
    client.close();
    expect(outcome).toBe("connected");
    expect(state).not.toBeNull();
  });
});
