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
});
