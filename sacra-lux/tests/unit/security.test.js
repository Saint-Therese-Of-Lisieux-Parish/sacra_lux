const EventEmitter = require("events");

describe("security", () => {
  let state;
  let security;
  let logger;

  beforeEach(() => {
    jest.resetModules();
    ({ state } = require("../../src/state"));
    security = require("../../src/security");
    logger = require("../../src/logger");
    jest.spyOn(console, "warn").mockImplementation(() => {});
    security.resetSecurityState();
    state.startPin = "";
    state.startPinHash = null;
    state.controlMode = "unset";
  });

  test("without a PIN, only loopback clients control until trusted-LAN is chosen", () => {
    const makeReq = (address) => ({ headers: {}, socket: { remoteAddress: address }, get: () => "" });
    const makeSocket = (address) => ({ request: { socket: { remoteAddress: address } }, handshake: { headers: {} }, data: {} });

    expect(security.clientMayControl(makeReq("127.0.0.1"))).toBe(true);
    expect(security.clientMayControl(makeReq("::ffff:127.0.0.1"))).toBe(true);
    expect(security.clientMayControl(makeReq("::1"))).toBe(true);
    expect(security.clientMayControl(makeReq("192.168.1.50"))).toBe(false);
    expect(security.clientHasControlSession(makeReq("192.168.1.50"))).toBe(false);
    expect(security.socketMayControl(makeSocket("192.168.1.50"))).toBe(false);
    expect(security.socketHasControlSession(makeSocket("192.168.1.50"))).toBe(false);
    expect(security.socketMayControl(makeSocket("::ffff:127.0.0.1"))).toBe(true);

    state.controlMode = "trusted-lan";
    expect(security.clientMayControl(makeReq("192.168.1.50"))).toBe(true);
    expect(security.socketMayControl(makeSocket("192.168.1.50"))).toBe(true);
  });

  test("trusted-LAN mode does not bypass a configured PIN", () => {
    state.controlMode = "trusted-lan";
    state.startPinHash = security.createPinHashRecord("1234");
    const remoteReq = { headers: {}, socket: { remoteAddress: "192.168.1.50" }, get: () => "" };

    expect(security.clientMayControl(remoteReq)).toBe(false);
  });

  test("normalizes unknown control modes to unset", () => {
    expect(security.normalizeControlMode("trusted-lan")).toBe("trusted-lan");
    expect(security.normalizeControlMode("anything")).toBe("unset");
    expect(security.normalizeControlMode(undefined)).toBe("unset");
  });

  test("hashes and verifies configured PINs", () => {
    state.startPinHash = security.createPinHashRecord("1234");

    expect(security.hasPinConfigured()).toBe(true);
    expect(security.verifyPin("1234")).toBe(true);
    expect(security.verifyPin("12 34")).toBe(true);
    expect(security.verifyPin("9999")).toBe(false);
  });

  test("rejects malformed and legacy PIN values without throwing", () => {
    state.startPin = "1234";
    expect(security.verifyPin(null)).toBe(false);
    expect(security.verifyPin(1234)).toBe(true);
    expect(security.verifyPin({})).toBe(false);

    state.startPinHash = {
      hash: "00",
      salt: "salt",
      iterations: 1
    };
    expect(security.verifyPin("1234")).toBe(false);
  });

  test("remote control stays locked until a session token is issued", () => {
    state.startPinHash = security.createPinHashRecord("1234");
    const remoteReq = {
      headers: {},
      socket: { remoteAddress: "192.168.1.50" },
      get(name) {
        return this.headers[String(name || "").toLowerCase()] || "";
      }
    };
    const remoteSocket = { handshake: { address: "192.168.1.50", headers: {} }, data: {} };

    expect(security.clientMayControl(remoteReq)).toBe(false);
    expect(security.socketMayControl(remoteSocket)).toBe(false);

    const token = security.noteControlUnlock(remoteReq);
    remoteReq.headers["x-sacra-control"] = token;
    remoteSocket.handshake.auth = { token: "not-a-session" };
    expect(security.clientMayControl(remoteReq)).toBe(true);
    expect(security.socketMayControl(remoteSocket)).toBe(false);

    remoteSocket.handshake.auth = { token };
    expect(security.socketMayControl(remoteSocket)).toBe(true);

    const secondLocalReq = {
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      get() { return ""; }
    };
    expect(security.clientMayControl(secondLocalReq)).toBe(false);
    const secondLocalSocket = { handshake: { address: "::ffff:127.0.0.1", headers: {} }, data: {} };
    expect(security.socketMayControl(secondLocalSocket)).toBe(false);
    remoteSocket.handshake.auth = { token: "not-a-session" };
    expect(security.socketMayControl(remoteSocket)).toBe(false);
  });

  test("issues start tokens bound to client ip and user agent", () => {
    const token = security.issueStartToken({
      ip: "127.0.0.1",
      userAgent: "jest"
    });

    expect(security.isStartTokenValid({
      token,
      ip: "127.0.0.1",
      userAgent: "jest"
    })).toBe(true);
    expect(security.isStartTokenValid({
      token,
      ip: "127.0.0.2",
      userAgent: "jest"
    })).toBe(false);

    security.clearStartToken();

    expect(security.isStartTokenValid({
      token,
      ip: "127.0.0.1",
      userAgent: "jest"
    })).toBe(false);
  });

  test("keeps each start link valid until it is used or expires", () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    const first = security.issueStartToken({ ip: "10.0.0.1", userAgent: "phone-a" });
    const second = security.issueStartToken({ ip: "10.0.0.2", userAgent: "phone-b" });

    expect(first).not.toBe(second);
    expect(security.isStartTokenValid({ token: first, ip: "10.0.0.1", userAgent: "phone-a" })).toBe(true);
    expect(security.isStartTokenValid({ token: second, ip: "10.0.0.2", userAgent: "phone-b" })).toBe(true);

    security.clearStartToken(first);

    expect(security.isStartTokenValid({ token: first, ip: "10.0.0.1", userAgent: "phone-a" })).toBe(false);
    expect(security.isStartTokenValid({ token: second, ip: "10.0.0.2", userAgent: "phone-b" })).toBe(true);
    expect(security.isStartTokenValid({ token: second, ip: "10.0.0.1", userAgent: "phone-a" })).toBe(false);

    nowSpy.mockReturnValue(now + (60 * 60 * 1000) + 1);
    expect(security.isStartTokenValid({ token: second, ip: "10.0.0.2", userAgent: "phone-b" })).toBe(false);
  });

  test("prunes expired links and evicts the oldest link at the limit", () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    const expired = security.issueStartToken({ ip: "10.0.0.1", userAgent: "expired" });

    nowSpy.mockReturnValue(now + (60 * 60 * 1000) + 1);
    const current = security.issueStartToken({ ip: "10.0.0.2", userAgent: "current" });
    expect(security.isStartTokenValid({ token: expired, ip: "10.0.0.1", userAgent: "expired" })).toBe(false);

    nowSpy.mockReturnValue(now);
    const tokens = Array.from({ length: 100 }, (_, index) => security.issueStartToken({
      ip: `10.0.0.${index + 10}`,
      userAgent: `phone-${index}`
    }));
    const newest = security.issueStartToken({ ip: "10.0.0.250", userAgent: "newest" });

    expect(security.isStartTokenValid({ token: current, ip: "10.0.0.2", userAgent: "current" })).toBe(false);
    expect(security.isStartTokenValid({ token: tokens[99], ip: "10.0.0.109", userAgent: "phone-99" })).toBe(true);
    expect(security.isStartTokenValid({ token: newest, ip: "10.0.0.250", userAgent: "newest" })).toBe(true);
    expect(security.isStartTokenValid({ token: null, ip: "10.0.0.250", userAgent: "newest" })).toBe(false);
    expect(security.issueStartToken({ ip: "10.0.0.251" })).toEqual(expect.any(String));
  });

  test("tracks PIN failures and lockouts by client ip", () => {
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);

    security.registerPinFailure("1.2.3.4");
    security.registerPinFailure("1.2.3.4");
    const third = security.registerPinFailure("1.2.3.4");

    expect(third.failures).toBe(3);
    expect(third.lockUntil).toBe(now + 60000);
    expect(security.getActiveLock("1.2.3.4")).toEqual(third);

    security.clearPinFailures("1.2.3.4");
    expect(security.getActiveLock("1.2.3.4")).toBeNull();
  });

  test("applies the longer lockout periods and allows a PIN after lockout ends", () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    for (let index = 0; index < 6; index += 1) {
      security.registerPinFailure("1.2.3.5");
    }
    expect(security.getActiveLock("1.2.3.5").lockUntil).toBe(now + (5 * 60 * 1000));
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    security.registerPinFailure("1.2.3.6");
    expect(security.getActiveLock("1.2.3.6").lockUntil).toBe(now + (15 * 60 * 1000));

    nowSpy.mockReturnValue(now + (16 * 60 * 1000));
    expect(security.getActiveLock("1.2.3.6")).toBeNull();
    state.startPin = "1234";
    expect(security.verifyPin("1234")).toBe(true);
  });

  test("expires control sessions and reads header and cookie forms", () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    const token = security.noteControlUnlock();
    const headerSource = { headers: { "x-sacra-control": [token] } };
    expect(security.getValidControlSessionToken(headerSource)).toBe(token);
    const cookieSource = { headers: { cookie: `sacra_lux_control=${encodeURIComponent(token)}` } };
    expect(security.getValidControlSessionToken(cookieSource)).toBe(token);
    expect(security.getValidControlSessionToken(null)).toBe("");

    nowSpy.mockReturnValue(now + (12 * 60 * 60 * 1000) + 1);
    expect(security.getValidControlSessionToken(headerSource)).toBe("");
    expect(security.clientHasControlSession({ headers: {}, socket: { remoteAddress: "192.168.1.50" } })).toBe(false);
  });

  test("rate limit middleware blocks excess requests and sets retry headers", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const middleware = security.createRateLimitMiddleware({
      bucket: "auth",
      windowMs: 60000,
      max: 1,
      label: "auth-test",
      keyFn: () => "client-a"
    });
    const req = { method: "POST", originalUrl: "/api/verify-pin", path: "/api/verify-pin" };
    const next = jest.fn();

    const okRes = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    middleware(req, okRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(okRes.status).not.toHaveBeenCalled();

    const limitedRes = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    middleware(req, limitedRes, next);

    expect(limitedRes.set).toHaveBeenCalledWith("Retry-After", "60");
    expect(limitedRes.status).toHaveBeenCalledWith(429);
    expect(limitedRes.json).toHaveBeenCalledWith({ error: "Too many requests. Please try again later." });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[rate-limit] auth-test throttled for client-a."));
  });

  test("uses request fallbacks and resets a rate limit after its window", () => {
    const now = Date.now();
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(now);
    const middleware = security.createRateLimitMiddleware({
      bucket: "global",
      windowMs: 60000,
      max: 1,
      label: "global-test"
    });
    const next = jest.fn();
    const response = () => ({ set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() });

    middleware({ ip: "" , connection: { remoteAddress: "client-c" } }, response(), next);
    middleware({ ip: "", connection: {} }, response(), next);
    nowSpy.mockReturnValue(now + 60001);
    middleware({ ip: "", connection: { remoteAddress: "client-c" } }, response(), next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(() => security.createRateLimitMiddleware({ bucket: "missing", windowMs: 1, max: 1, label: "bad" })({}, response(), next)).toThrow("Unknown rate limit bucket");
  });

  test("concurrent middleware releases the bucket after the response finishes", () => {
    const middleware = security.createConcurrentLimitMiddleware({
      bucket: "upload",
      maxConcurrent: 1,
      label: "upload-test",
      keyFn: () => "client-b"
    });
    const req = { method: "POST", originalUrl: "/api/import", path: "/api/import" };
    const next = jest.fn();

    const firstRes = new EventEmitter();
    firstRes.set = jest.fn();
    firstRes.status = jest.fn().mockReturnThis();
    firstRes.json = jest.fn();
    middleware(req, firstRes, next);

    expect(next).toHaveBeenCalledTimes(1);

    const blockedRes = new EventEmitter();
    blockedRes.set = jest.fn();
    blockedRes.status = jest.fn().mockReturnThis();
    blockedRes.json = jest.fn();
    middleware(req, blockedRes, next);

    expect(blockedRes.set).toHaveBeenCalledWith("Retry-After", "1");
    expect(blockedRes.status).toHaveBeenCalledWith(429);

    firstRes.emit("finish");

    const releasedRes = new EventEmitter();
    releasedRes.set = jest.fn();
    releasedRes.status = jest.fn().mockReturnThis();
    releasedRes.json = jest.fn();
    middleware(req, releasedRes, next);

    expect(releasedRes.status).not.toHaveBeenCalled();
  });

  test("releases concurrent slots one at a time and rejects an unknown bucket", () => {
    const middleware = security.createConcurrentLimitMiddleware({
      bucket: "upload",
      maxConcurrent: 2,
      label: "upload-test",
      keyFn: () => "client-d"
    });
    const makeResponse = () => {
      const response = new EventEmitter();
      response.set = jest.fn();
      response.status = jest.fn().mockReturnThis();
      response.json = jest.fn();
      return response;
    };
    const next = jest.fn();
    const first = makeResponse();
    const second = makeResponse();
    middleware({}, first, next);
    middleware({}, second, next);
    first.emit("finish");
    second.emit("close");
    expect(() => security.createConcurrentLimitMiddleware({ bucket: "missing", maxConcurrent: 1, label: "bad" })({}, makeResponse(), next)).toThrow("Unknown concurrent limit bucket");
  });

  test("socket rate limit guard enforces request and concurrency limits", () => {
    const guard = security.createSocketRateLimitGuard({
      bucket: "heavy",
      windowMs: 60000,
      max: 10,
      maxConcurrent: 1,
      label: "socket-heavy"
    });
    const socket = {
      handshake: {
        address: "10.0.0.5",
        headers: {}
      }
    };

    const first = guard(socket);
    expect(first.allowed).toBe(true);

    const second = guard(socket);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSec).toBe(1);

    first.release();

    const third = guard(socket);
    expect(third.allowed).toBe(true);

    const fourth = guard(socket);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBe(1);

    third.release();
  });

  test("allows socket requests without a concurrency limit and ignores repeated release", () => {
    const guard = security.createSocketRateLimitGuard({
      bucket: "global",
      windowMs: 60000,
      max: 2,
      label: "socket-global"
    });
    const socket = { conn: { remoteAddress: "10.0.0.8" }, handshake: { headers: {} } };
    const result = guard(socket);
    expect(result.allowed).toBe(true);
    result.release();
    result.release();
    expect(guard({ handshake: { address: "10.0.0.9", headers: {} } }).allowed).toBe(true);
    expect(guard({ handshake: { headers: {} } }).allowed).toBe(true);
    expect(() => security.createSocketRateLimitGuard({ bucket: "missing", windowMs: 1, max: 1, label: "bad" })(socket)).toThrow("Unknown rate limit bucket");
  });

  test("socket rate limit uses the connection address for every socket", () => {
    const guard = security.createSocketRateLimitGuard({
      bucket: "heavy",
      windowMs: 60000,
      max: 3,
      maxConcurrent: 1,
      label: "socket-heavy"
    });
    const socketFrom = (address, forwardedFor) => ({
      handshake: {
        address,
        headers: { "x-forwarded-for": forwardedFor }
      },
      request: {
        socket: { remoteAddress: address }
      }
    });

    const first = guard(socketFrom("192.0.2.10", "203.0.113.1"));
    expect(first.allowed).toBe(true);

    const sameHost = guard(socketFrom("192.0.2.10", "203.0.113.2"));
    expect(sameHost.allowed).toBe(false);
    expect(sameHost.retryAfterSec).toBe(1);

    first.release();

    const secondRequest = guard(socketFrom("192.0.2.10", "198.51.100.8"));
    expect(secondRequest.allowed).toBe(true);
    secondRequest.release();

    const overCap = guard(socketFrom("192.0.2.10", "198.51.100.9"));
    expect(overCap.allowed).toBe(false);
    expect(overCap.retryAfterSec).toBeGreaterThan(1);

    const spoofedHandshake = guard({
      handshake: {
        address: "192.0.2.99",
        headers: { "x-forwarded-for": "203.0.113.50" }
      },
      request: {
        socket: { remoteAddress: "192.0.2.10" }
      }
    });
    expect(spoofedHandshake.allowed).toBe(false);

    const otherHost = guard(socketFrom("192.0.2.11", "203.0.113.1"));
    expect(otherHost.allowed).toBe(true);
    otherHost.release();
  });

  test("reads the control token from get(), header, or cookie in that order", () => {
    const token = security.noteControlUnlock();
    const other = security.noteControlUnlock();
    const viaGet = { get: (name) => (name === "x-sacra-control" ? token : ""), headers: { "x-sacra-control": other } };
    expect(security.getValidControlSessionToken(viaGet)).toBe(token);

    const emptyGet = { get: () => "", headers: { "x-sacra-control": other } };
    expect(security.getValidControlSessionToken(emptyGet)).toBe(other);

    const arrayHeader = { headers: { "x-sacra-control": [token, other] } };
    expect(security.getValidControlSessionToken(arrayHeader)).toBe(token);

    const cookie = { headers: { cookie: `theme=dark; sacra_lux_control=${token}; other=1` } };
    expect(security.getValidControlSessionToken(cookie)).toBe(token);
    expect(security.getValidControlSessionToken({ headers: { cookie: `xsacra_lux_control=${token}` } })).toBe("");
    expect(security.getValidControlSessionToken({ headers: { cookie: "sacra_lux_control=" } })).toBe("");
    expect(security.getValidControlSessionToken({ headers: {} })).toBe("");
    expect(security.getValidControlSessionToken({})).toBe("");
  });

  test("reads the socket control token from data, auth, or handshake", () => {
    state.startPinHash = security.createPinHashRecord("1234");
    const token = security.noteControlUnlock();
    const header = { headers: { "x-sacra-control": token } };

    expect(security.socketMayControl({ data: { controlToken: token } })).toBe(true);
    expect(security.socketMayControl({ handshake: { auth: { token } } })).toBe(true);
    expect(security.socketMayControl({ handshake: header })).toBe(true);
    expect(security.socketMayControl({ handshake: { auth: { token: "bad" } } })).toBe(false);
    expect(security.socketMayControl({})).toBe(false);
    expect(security.socketMayControl(null)).toBe(false);

    expect(security.socketHasControlSession({ data: { controlToken: token } })).toBe(true);
    expect(security.socketHasControlSession({ handshake: { auth: { token } } })).toBe(true);
    expect(security.socketHasControlSession({ handshake: header })).toBe(true);
    expect(security.socketHasControlSession({ handshake: { auth: { token: "bad" } } })).toBe(false);
    expect(security.socketHasControlSession({})).toBe(false);
  });

  test("a configured PIN requires a valid session token for requests", () => {
    state.startPinHash = security.createPinHashRecord("1234");
    const token = security.noteControlUnlock();
    const remote = (headers) => ({ headers, socket: { remoteAddress: "127.0.0.1" } });

    expect(security.clientMayControl(remote({ "x-sacra-control": token }))).toBe(true);
    expect(security.clientMayControl(remote({ "x-sacra-control": "bad" }))).toBe(false);
    expect(security.clientMayControl(remote({}))).toBe(false);
    expect(security.clientHasControlSession(remote({ "x-sacra-control": token }))).toBe(true);
    expect(security.clientHasControlSession(remote({}))).toBe(false);
  });

  test("request address falls back from socket to connection to ip", () => {
    const control = (req) => security.clientMayControl({ headers: {}, ...req });
    expect(control({ socket: { remoteAddress: "127.0.0.1" }, connection: { remoteAddress: "10.0.0.1" }, ip: "10.0.0.2" })).toBe(true);
    expect(control({ socket: {}, connection: { remoteAddress: "127.0.0.1" }, ip: "10.0.0.2" })).toBe(true);
    expect(control({ connection: { remoteAddress: "10.0.0.1" }, ip: "127.0.0.1" })).toBe(false);
    expect(control({ ip: "127.0.0.1" })).toBe(true);
    expect(control({ ip: "10.0.0.2" })).toBe(false);
    expect(control({})).toBe(false);
    expect(control({ connection: {} })).toBe(false);
    expect(security.clientHasControlSession({ ip: "127.0.0.1" })).toBe(true);
    expect(security.clientMayControl(null)).toBe(false);
  });

  test("socket address falls back from request to connection to handshake", () => {
    const may = (socket) => security.socketMayControl(socket);
    expect(may({ request: { socket: { remoteAddress: "127.0.0.1" } }, conn: { remoteAddress: "10.0.0.1" }, handshake: { address: "10.0.0.2" } })).toBe(true);
    expect(may({ request: { socket: {} }, conn: { remoteAddress: "127.0.0.1" }, handshake: { address: "10.0.0.2" } })).toBe(true);
    expect(may({ request: {}, conn: { remoteAddress: "10.0.0.1" }, handshake: { address: "127.0.0.1" } })).toBe(false);
    expect(may({ conn: {}, handshake: { address: "127.0.0.1" } })).toBe(true);
    expect(may({ handshake: {} })).toBe(false);
    expect(may({})).toBe(false);
    expect(may(null)).toBe(false);
  });

  test("loopback detection handles IPv4, IPv6, mapped, and empty values", () => {
    expect(security.isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(security.isLoopbackAddress("127.5.5.5")).toBe(true);
    expect(security.isLoopbackAddress("::1")).toBe(true);
    expect(security.isLoopbackAddress("::FFFF:127.0.0.1")).toBe(true);
    expect(security.isLoopbackAddress("1127.0.0.1")).toBe(false);
    expect(security.isLoopbackAddress("10.127.0.1")).toBe(false);
    expect(security.isLoopbackAddress("::2")).toBe(false);
    expect(security.isLoopbackAddress("")).toBe(false);
    expect(security.isLoopbackAddress(undefined)).toBe(false);
  });

  test("client ip falls back to the connection address and unknown", () => {
    expect(security.getClientIp({ ip: "1.1.1.1", connection: { remoteAddress: "2.2.2.2" } })).toBe("1.1.1.1");
    expect(security.getClientIp({ connection: { remoteAddress: "2.2.2.2" } })).toBe("2.2.2.2");
    expect(security.getClientIp({})).toBe("unknown");
  });

  test("logs a throttled request with its details", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const middleware = security.createConcurrentLimitMiddleware({ bucket: "heavy", maxConcurrent: 1, label: "heavy-api", keyFn: () => "k1" });
    const makeRes = () => ({ on: jest.fn(), set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() });
    const first = makeRes();
    middleware({ method: "POST", originalUrl: "/a" }, first, jest.fn());
    const second = makeRes();
    const next = jest.fn();
    middleware({ method: "POST", path: "/b" }, second, next);

    expect(next).not.toHaveBeenCalled();
    expect(second.set).toHaveBeenCalledWith("Retry-After", "1");
    expect(second.status).toHaveBeenCalledWith(429);
    expect(warnSpy).toHaveBeenCalledWith("[rate-limit] heavy-api throttled for k1. POST /b concurrent=1");

    const listeners = Object.fromEntries(first.on.mock.calls);
    listeners.finish();
    listeners.close();
    const third = makeRes();
    const thirdNext = jest.fn();
    middleware({ method: "POST", originalUrl: "/c" }, third, thirdNext);
    expect(thirdNext).toHaveBeenCalled();
  });

  test("repeated throttles of the same request log one warning for each window", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1000000);
    const middleware = security.createRateLimitMiddleware({ bucket: "global", windowMs: 60000, max: 1, label: "global-api", keyFn: () => "k1" });
    const makeRes = () => ({ set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() });
    const req = { method: "POST", originalUrl: "/api/preview-reading" };
    middleware(req, makeRes(), jest.fn());
    for (let i = 0; i < 4; i += 1) {
      const res = makeRes();
      middleware(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(429);
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(1000000 + 60001);
    middleware(req, makeRes(), jest.fn());
    middleware(req, makeRes(), jest.fn());
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenLastCalledWith(expect.stringContaining("(3 similar requests throttled since the last warning)"));
    nowSpy.mockRestore();
  });

  test("throttle warnings strip line breaks from client input", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const middleware = security.createRateLimitMiddleware({ bucket: "global", windowMs: 60000, max: 1, label: "global-api", keyFn: () => "k1" });
    const makeRes = () => ({ set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() });
    const req = { method: "GET", originalUrl: "/a\r\n[fake] forged line" };
    middleware(req, makeRes(), jest.fn());
    middleware(req, makeRes(), jest.fn());
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).not.toMatch(/[\r\n]/);
  });

  test("log line for a socket throttle carries the retry detail", () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const guard = security.createSocketRateLimitGuard({ bucket: "auth", windowMs: 1000, max: 1, label: "auth-api" });
    const socket = { request: { socket: { remoteAddress: "9.9.9.9" } } };
    guard(socket);
    guard(socket);
    expect(warnSpy).toHaveBeenCalledWith("[rate-limit] auth-api throttled for 9.9.9.9. socket retry-after=1s");
  });

  test("concurrent slots keep a count above one", () => {
    const guard = security.createSocketRateLimitGuard({ bucket: "upload", windowMs: 60000, max: 10, maxConcurrent: 2, label: "u" });
    const socket = { request: { socket: { remoteAddress: "8.8.8.8" } } };
    const a = guard(socket);
    const b = guard(socket);
    expect(guard(socket).allowed).toBe(false);
    a.release();
    a.release();
    expect(guard(socket).allowed).toBe(true);
    expect(guard(socket).allowed).toBe(false);
    b.release();
  });

  describe("scheduled cleanup", () => {
    const FIVE_MINUTES = 5 * 60000;
    let timerSecurity;

    beforeEach(() => {
      jest.resetModules();
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const { state: timerState } = require("../../src/state");
      timerSecurity = require("../../src/security");
      timerState.startPin = "";
      timerState.startPinHash = null;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test("removes expired start links but keeps live ones", () => {
      const old = timerSecurity.issueStartToken({ ip: "1.1.1.1", userAgent: "ua" });
      jest.advanceTimersByTime(59 * 60000);
      const fresh = timerSecurity.issueStartToken({ ip: "1.1.1.1", userAgent: "ua" });
      jest.advanceTimersByTime(2 * 60000);
      expect(timerSecurity.isStartTokenValid({ token: old, ip: "1.1.1.1", userAgent: "ua" })).toBe(false);
      expect(timerSecurity.isStartTokenValid({ token: fresh, ip: "1.1.1.1", userAgent: "ua" })).toBe(true);
    });

    test("drops rate limit windows once they reset", () => {
      const run = () => timerSecurity.createSocketRateLimitGuard({ bucket: "auth", windowMs: 10 * 60000, max: 1, label: "a" })(
        { request: { socket: { remoteAddress: "2.2.2.2" } } }
      );
      expect(run().allowed).toBe(true);
      jest.advanceTimersByTime(FIVE_MINUTES);
      expect(run().allowed).toBe(false);
      jest.advanceTimersByTime(5 * 60000);
      expect(run().allowed).toBe(true);
    });

    test("forgets old PIN failures only after 24 hours without a failure", () => {
      timerSecurity.registerPinFailure("3.3.3.3");
      jest.advanceTimersByTime(15 * 60000);
      expect(timerSecurity.registerPinFailure("3.3.3.3").failures).toBe(2);
      jest.advanceTimersByTime(23 * 60 * 60000);
      expect(timerSecurity.registerPinFailure("3.3.3.3").failures).toBe(3);
      jest.advanceTimersByTime(25 * 60 * 60000);
      expect(timerSecurity.registerPinFailure("3.3.3.3").failures).toBe(1);
    });

    test("keeps the lockout count after 30 minutes and starts a new lock on the next failure", () => {
      for (let index = 0; index < 9; index += 1) {
        timerSecurity.registerPinFailure("7.7.7.7");
      }
      jest.advanceTimersByTime(30 * 60000);
      expect(timerSecurity.getActiveLock("7.7.7.7")).toBeNull();
      const next = timerSecurity.registerPinFailure("7.7.7.7");
      expect(next.failures).toBe(10);
      expect(Math.round((next.lockUntil - Date.now()) / 1000)).toBe(15 * 60);
      expect(timerSecurity.getActiveLock("7.7.7.7")).not.toBeNull();
    });

    test("logs one warning when 50 PIN failures come from many addresses", () => {
      const warnSpy = jest.spyOn(require("../../src/logger"), "warn").mockImplementation(() => {});
      for (let index = 0; index < 49; index += 1) {
        timerSecurity.registerPinFailure(`10.0.0.${index % 10}`);
      }
      expect(warnSpy).not.toHaveBeenCalled();
      timerSecurity.registerPinFailure("10.0.0.1");
      timerSecurity.registerPinFailure("10.0.0.2");
      const alerts = warnSpy.mock.calls.filter(([message]) => String(message).includes("PIN failures"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0][0]).toContain("50");
      warnSpy.mockRestore();
    });

    test("keeps a PIN record while its lock is active", () => {
      for (let index = 0; index < 9; index += 1) {
        timerSecurity.registerPinFailure("4.4.4.4");
      }
      jest.advanceTimersByTime(10 * 60000);
      expect(timerSecurity.getActiveLock("4.4.4.4")).not.toBeNull();
      expect(timerSecurity.registerPinFailure("4.4.4.4").failures).toBe(10);
    });
  });

  test("resetSecurityState clears links, sessions, lockouts, and rate limits", () => {
    const link = security.issueStartToken({ ip: "5.5.5.5", userAgent: "ua" });
    const session = security.noteControlUnlock();
    security.registerPinFailure("5.5.5.5");
    const socket = { request: { socket: { remoteAddress: "5.5.5.5" } } };
    const guard = security.createSocketRateLimitGuard({ bucket: "heavy", windowMs: 60000, max: 1, maxConcurrent: 1, label: "h" });
    guard(socket);

    security.resetSecurityState();

    expect(security.isStartTokenValid({ token: link, ip: "5.5.5.5", userAgent: "ua" })).toBe(false);
    expect(security.getValidControlSessionToken({ headers: { "x-sacra-control": session } })).toBe("");
    expect(security.getActiveLock("5.5.5.5")).toBeNull();
    expect(security.registerPinFailure("5.5.5.5").failures).toBe(1);
    expect(guard(socket).allowed).toBe(true);
  });

  test("clearStartToken removes one link and clearControlAccess removes sessions", () => {
    const a = security.issueStartToken({ ip: "6.6.6.6", userAgent: "ua" });
    const b = security.issueStartToken({ ip: "6.6.6.6", userAgent: "ua" });
    security.clearStartToken(a);
    expect(security.isStartTokenValid({ token: a, ip: "6.6.6.6", userAgent: "ua" })).toBe(false);
    expect(security.isStartTokenValid({ token: b, ip: "6.6.6.6", userAgent: "ua" })).toBe(true);
    const session = security.noteControlUnlock();
    security.clearControlAccess();
    expect(security.getValidControlSessionToken({ headers: { "x-sacra-control": session } })).toBe("");
  });

  test("cleanupSecurityState removes expired control sessions", () => {
    const session = security.noteControlUnlock();
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now + 12 * 60 * 60 * 1000 + 1);

    security.cleanupSecurityState();

    expect(security.getValidControlSessionToken({ headers: { "x-sacra-control": session } })).toBe("");
  });
});
