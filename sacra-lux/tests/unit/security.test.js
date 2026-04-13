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
  });

  test("hashes and verifies configured PINs", () => {
    state.startPinHash = security.createPinHashRecord("1234");

    expect(security.hasPinConfigured()).toBe(true);
    expect(security.verifyPin("1234")).toBe(true);
    expect(security.verifyPin("12 34")).toBe(true);
    expect(security.verifyPin("9999")).toBe(false);
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
});
