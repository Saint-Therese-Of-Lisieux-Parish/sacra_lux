const request = require("supertest");
const { io: createClient } = require("socket.io-client");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

// Every HTTP route and Socket.IO event with the access it needs.
//   public  - no control session needed. The reason is in the comment.
//   control - a control session is needed. A client without one is rejected.
// A route or event that is missing from this table fails the test, so a new
// route cannot ship with no decision about its access.
const ROUTES = [
  // Pages: the operator, the projector, and the phone load them before login.
  ["GET", "/", "public"],
  ["GET", "/app", "public"],
  ["GET", "/screen", "public"], // The projector display has no login.
  ["GET", "/remote", "public"], // The phone remote shows the PIN form here.
  ["GET", "/start", "public"], // Shows the PIN form for the start link.
  ["GET", "/api/state", "public"], // The safe snapshot has no PIN data.
  ["GET", "/api/mass-assets", "public"], // The display loads media from here.
  ["GET", "/api/mass-asset/:filename", "public"], // The display loads media.
  ["GET", "/api/builtin-backgrounds", "public"], // Static theme assets.
  ["GET", "/api/prayers", "public"], // Built-in prayer list.
  ["GET", "/api/prayers/:filename", "public"], // Built-in prayer text.
  ["GET", "/api/themes", "public"], // Static theme list.
  ["GET", "/api/theme-vars", "public"], // Static theme values.
  ["GET", "/api/mass-history", "public"], // Archive list for the library dialog.
  ["GET", "/api/server-info", "public"], // The remote needs the network address.
  ["GET", "/api/session-info", "public"], // The handler hides file paths from clients with no control.
  ["GET", "/api/export-settings", "public"], // The handler hides file paths from clients with no control.
  ["GET", "/api/start-redirect", "public"], // It checks a one-time start token.
  ["POST", "/api/verify-pin", "public"], // It checks the PIN and has lockouts.
  ["POST", "/api/start-pin", "public"], // It checks the current PIN in the handler.
  ["POST", "/api/preview-reading", "public"], // Read-only preview. It does not change state.
  ["POST", "/api/preview-manual-slide", "public"], // Read-only preview. It does not change state.

  ["GET", "/api/export-mass-zip", "control"],
  ["GET", "/api/export-mass-zip-avif", "control"],
  ["POST", "/api/upload-mass-asset", "control"],
  ["POST", "/api/upload-image", "control"],
  ["POST", "/api/import-slideshow-images", "control"],
  ["POST", "/api/image-slideshow/preflight", "control"],
  ["POST", "/api/screen-settings", "control"],
  ["POST", "/api/app-settings", "control"],
  ["POST", "/api/update-title", "control"],
  ["POST", "/api/start-time", "control"],
  ["POST", "/api/control-mode", "control"],
  ["POST", "/api/pre-mass/start", "control"],
  ["POST", "/api/pre-mass/stop", "control"],
  ["POST", "/api/gathering/start", "control"],
  ["POST", "/api/gathering/stop", "control"],
  ["POST", "/api/post-mass/start", "control"],
  ["POST", "/api/post-mass/stop", "control"],
  ["POST", "/api/import-settings", "control"],
  ["POST", "/api/duplicate-mass", "control"],
  ["POST", "/api/new-mass", "control"],
  ["POST", "/api/import-mass-zip", "control"],
  ["POST", "/api/mass-history/:archiveId/load", "control"],
  ["POST", "/api/mass-history/:archiveId/compress", "control"],
  ["DELETE", "/api/mass-history/:archiveId", "control"],
  ["POST", "/api/organizer", "control"],
  ["POST", "/api/load-readings", "control"],
  ["POST", "/api/reload-mass-folder", "control"],
  ["POST", "/api/save-reading", "control"]
];

const SOCKET_EVENTS = [
  ["control:auth", "public"], // It is how a client gets control. It checks the token.
  ["screen:settings", "control"],
  ["slide:next", "control"],
  ["slide:prev", "control"],
  ["slide:goto", "control"],
  ["slide:goto:remote", "control"],
  ["slide:video-ended", "control"],
  ["slide:video-ready", "control"],
  ["image-slideshow:preload-error", "control"],
  ["screen:interstitial-hold", "control"],
  ["screen:black", "control"],
  ["export:avif:start", "control"]
];

const routeKey = (method, routePath) => `${method} ${routePath}`;
const REJECTED = [401, 403];

describe("authorization matrix", () => {
  let handle;
  let app;
  let state;
  let security;
  let sessionToken;
  let ipCounter = 0;

  // Each request uses its own client address so the rate limits do not
  // change the status that the test reads.
  function nextIp() {
    ipCounter += 1;
    return `10.${Math.floor(ipCounter / 65025) % 255}.${Math.floor(ipCounter / 255) % 255}.${(ipCounter % 255) + 1}`;
  }

  function send(method, routePath, token) {
    const concretePath = routePath.replace(/:[A-Za-z]+/g, "x");
    let pending = request(app)[method.toLowerCase()](concretePath).set("X-Forwarded-For", nextIp());
    if (token) pending = pending.set("X-Sacra-Control", token);
    return method === "GET" ? pending : pending.send({});
  }

  // Move the clock 13 hours ahead for src/security.js only. A global jump
  // makes the Socket.IO ping timer close the test connection.
  function skipClockForSecurityModule() {
    const realNow = Date.now.bind(Date);
    jest.spyOn(Date, "now").mockImplementation(() => (
      /security\.js/.test(new Error().stack) ? realNow() + 13 * 60 * 60 * 1000 : realNow()
    ));
  }

  function registeredRoutes() {
    return app.router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods)
        .filter((method) => method !== "_all")
        .map((method) => routeKey(method.toUpperCase(), layer.route.path)));
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-authz-") });
    app = handle.app;
    app.set("trust proxy", true);
    security = require("../../src/security");
    ({ state } = require("../../src/state"));
    security.resetSecurityState();
    // A PIN makes every client prove a control session, including loopback.
    state.startPinHash = security.createPinHashRecord("123456");
    sessionToken = security.noteControlUnlock();
  });

  afterAll(async () => {
    state.startPinHash = null;
    security.resetSecurityState();
    await handle.stop();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("HTTP routes", () => {
    test("every registered route is in the table and every table entry is registered", () => {
      const tableKeys = ROUTES.map(([method, routePath]) => routeKey(method, routePath));
      expect(registeredRoutes().sort()).toEqual(tableKeys.sort());
    });

    const controlRoutes = ROUTES.filter(([, , access]) => access === "control");

    test.each(controlRoutes)("%s %s rejects a client with no session", async (method, routePath) => {
      const response = await send(method, routePath);
      expect(REJECTED).toContain(response.status);
    });

    test.each(controlRoutes)("%s %s accepts a client with a valid session", async (method, routePath) => {
      const response = await send(method, routePath, sessionToken);
      expect(REJECTED).not.toContain(response.status);
    });

    test("a forged session token is rejected", async () => {
      const forged = `${sessionToken.slice(0, -1)}${sessionToken.endsWith("0") ? "1" : "0"}`;
      const response = await send("POST", "/api/organizer", forged);
      expect(REJECTED).toContain(response.status);
    });

    test("an expired session token is rejected", async () => {
      skipClockForSecurityModule();
      const response = await send("POST", "/api/organizer", sessionToken);
      expect(REJECTED).toContain(response.status);
    });

    test("a revoked session token is rejected", async () => {
      const revoked = security.noteControlUnlock();
      await send("POST", "/api/organizer", revoked).then((response) => {
        expect(REJECTED).not.toContain(response.status);
      });
      security.clearControlAccess();
      const response = await send("POST", "/api/organizer", revoked);
      expect(REJECTED).toContain(response.status);
      // Restore a session for the tests that run after this one.
      sessionToken = security.noteControlUnlock();
    });
  });

  describe("Socket.IO events", () => {
    let client;

    function connect(token) {
      return new Promise((resolve, reject) => {
        const socket = createClient(handle.baseUrl, {
          transports: ["websocket"],
          forceNew: true,
          auth: token ? { token } : {}
        });
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", reject);
      });
    }

    // Resolve true when the server answers with control:required in time.
    function emitAndWatch(socket, event) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 250);
        socket.once("control:required", () => {
          clearTimeout(timer);
          resolve(true);
        });
        socket.emit(event, {});
      });
    }

    afterEach(() => {
      if (client) client.disconnect();
      client = null;
    });

    test("every registered event is in the table and every table entry is registered", async () => {
      client = await connect();
      const serverSocket = [...handle.io.sockets.sockets.values()].pop();
      const registered = serverSocket.eventNames().filter((name) => typeof name === "string" && name !== "error");
      expect(registered.sort()).toEqual(SOCKET_EVENTS.map(([event]) => event).sort());
    });

    const controlEvents = SOCKET_EVENTS.filter(([, access]) => access === "control");

    test.each(controlEvents)("%s is refused for a client with no session", async (event) => {
      client = await connect();
      expect(await emitAndWatch(client, event)).toBe(true);
    });

    test.each(controlEvents)("%s is accepted for a client with a valid session", async (event) => {
      client = await connect(sessionToken);
      expect(await emitAndWatch(client, event)).toBe(false);
    });

    test("a forged token is refused", async () => {
      const forged = `${sessionToken.slice(0, -1)}${sessionToken.endsWith("0") ? "1" : "0"}`;
      client = await connect(forged);
      expect(await emitAndWatch(client, "slide:next")).toBe(true);
    });

    test("an expired token is refused", async () => {
      client = await connect(sessionToken);
      skipClockForSecurityModule();
      expect(await emitAndWatch(client, "slide:next")).toBe(true);
    });

    test("a revoked token is refused", async () => {
      const revoked = security.noteControlUnlock();
      client = await connect(revoked);
      expect(await emitAndWatch(client, "slide:next")).toBe(false);
      security.clearControlAccess();
      expect(await emitAndWatch(client, "slide:next")).toBe(true);
      sessionToken = security.noteControlUnlock();
    });
  });
});
