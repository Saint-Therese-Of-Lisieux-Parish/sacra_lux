const crypto = require("crypto");

const { state } = require("./state");
const logger = require("./logger");

const START_TOKEN_TTL_MS = 60 * 60 * 1000;
const PIN_HASH_ITERATIONS = 150000;
const PIN_HASH_KEYLEN = 64;
const PIN_HASH_DIGEST = "sha512";

const RATE_LIMIT_CONFIG = {
  global: { bucket: "global", windowMs: 60 * 1000, max: 120, label: "global-api" },
  auth: { bucket: "auth", windowMs: 5 * 60 * 1000, max: 10, label: "auth-api" },
  upload: { bucket: "upload", windowMs: 10 * 60 * 1000, max: 20, label: "upload-api", maxConcurrent: 2 },
  heavy: { bucket: "heavy", windowMs: 10 * 60 * 1000, max: 10, label: "heavy-api", maxConcurrent: 1 }
};

let startToken = null;
const pinLockouts = new Map();

const rateLimitBuckets = {
  global: new Map(),
  auth: new Map(),
  upload: new Map(),
  heavy: new Map()
};

const concurrentLimitBuckets = {
  upload: new Map(),
  heavy: new Map()
};

function getClientIp(req) {
  return String(req.ip || req.connection?.remoteAddress || "unknown");
}

function getSocketClientIp(socket) {
  const forwardedFor = socket?.handshake?.headers?.["x-forwarded-for"];
  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim() || "unknown";
  }
  return String(socket?.handshake?.address || socket?.request?.socket?.remoteAddress || "unknown");
}

function hashUserAgent(userAgent) {
  return crypto.createHash("sha256").update(String(userAgent || "")).digest("hex");
}

function hashPin(pin, salt, iterations = PIN_HASH_ITERATIONS) {
  return crypto.pbkdf2Sync(String(pin), String(salt), Number(iterations), PIN_HASH_KEYLEN, PIN_HASH_DIGEST).toString("hex");
}

function createPinHashRecord(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = PIN_HASH_ITERATIONS;
  const hash = hashPin(pin, salt, iterations);
  return { hash, salt, iterations, digest: PIN_HASH_DIGEST };
}

function hasPinConfigured() {
  return Boolean(state.startPinHash?.hash || state.startPin);
}

function verifyPin(pin) {
  const cleaned = String(pin || "").replace(/\D/g, "");
  if (state.startPinHash?.hash && state.startPinHash?.salt) {
    const computed = hashPin(cleaned, state.startPinHash.salt, state.startPinHash.iterations || PIN_HASH_ITERATIONS);
    const expectedBuffer = Buffer.from(String(state.startPinHash.hash), "hex");
    const computedBuffer = Buffer.from(String(computed), "hex");
    if (expectedBuffer.length !== computedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
  }
  return Boolean(state.startPin) && cleaned === String(state.startPin);
}

function getLockoutSeconds(failures) {
  if (failures >= 9) return 15 * 60;
  if (failures >= 6) return 5 * 60;
  if (failures >= 3) return 60;
  return 0;
}

function getActiveLock(ip) {
  const record = pinLockouts.get(ip);
  if (!record) {
    return null;
  }
  if (!record.lockUntil || record.lockUntil <= Date.now()) {
    return null;
  }
  return record;
}

function registerPinFailure(ip) {
  const now = Date.now();
  const previous = pinLockouts.get(ip) || { failures: 0, lockUntil: 0, lastFailureAt: 0 };
  const failures = previous.failures + 1;
  const lockSeconds = getLockoutSeconds(failures);
  const record = {
    failures,
    lockUntil: lockSeconds > 0 ? now + (lockSeconds * 1000) : 0,
    lastFailureAt: now
  };
  pinLockouts.set(ip, record);
  return record;
}

function clearPinFailures(ip) {
  pinLockouts.delete(ip);
}

function issueStartToken({ ip, userAgent }) {
  startToken = {
    token: crypto.randomBytes(16).toString("hex"),
    expiresAt: Date.now() + START_TOKEN_TTL_MS,
    ip,
    uaHash: hashUserAgent(userAgent)
  };
  return startToken.token;
}

function isStartTokenValid({ token, ip, userAgent }) {
  return Boolean(
    startToken
    && startToken.token
    && token
    && token === startToken.token
    && Number(startToken.expiresAt || 0) > Date.now()
    && startToken.ip === ip
    && startToken.uaHash === hashUserAgent(userAgent)
  );
}

function clearStartToken() {
  startToken = null;
}

function evaluateRateLimit({ bucket, key, windowMs, max, now = Date.now() }) {
  const store = rateLimitBuckets[bucket];
  if (!store) {
    throw new Error(`Unknown rate limit bucket: ${bucket}`);
  }

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  if (entry.count >= max) {
    store.set(key, entry);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  entry.count += 1;
  store.set(key, entry);
  return {
    allowed: true,
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

function logRateLimitExceeded(label, key, details = "") {
  const suffix = details ? ` ${details}` : "";
  logger.warn(`[rate-limit] ${label} throttled for ${key}.${suffix}`);
}

function createRateLimitMiddleware({ bucket, windowMs, max, label, keyFn = getClientIp }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const result = evaluateRateLimit({ bucket, key, windowMs, max });
    if (result.allowed) {
      next();
      return;
    }

    logRateLimitExceeded(label, key, `${req.method} ${req.originalUrl || req.path} retry-after=${result.retryAfterSec}s`);
    res.set("Retry-After", String(result.retryAfterSec));
    res.status(429).json({ error: "Too many requests. Please try again later." });
  };
}

function tryEnterConcurrentBucket(bucket, key, maxConcurrent) {
  const store = concurrentLimitBuckets[bucket];
  if (!store) {
    throw new Error(`Unknown concurrent limit bucket: ${bucket}`);
  }
  const current = store.get(key) || 0;
  if (current >= maxConcurrent) {
    return false;
  }
  store.set(key, current + 1);
  return true;
}

function leaveConcurrentBucket(bucket, key) {
  const store = concurrentLimitBuckets[bucket];
  if (!store) {
    return;
  }
  const current = store.get(key) || 0;
  if (current <= 1) {
    store.delete(key);
    return;
  }
  store.set(key, current - 1);
}

function createConcurrentLimitMiddleware({ bucket, maxConcurrent, label, keyFn = getClientIp }) {
  return (req, res, next) => {
    const key = keyFn(req);
    if (!tryEnterConcurrentBucket(bucket, key, maxConcurrent)) {
      logRateLimitExceeded(label, key, `${req.method} ${req.originalUrl || req.path} concurrent=${maxConcurrent}`);
      res.set("Retry-After", "1");
      res.status(429).json({ error: "Too many concurrent requests. Please try again later." });
      return;
    }

    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      leaveConcurrentBucket(bucket, key);
    };

    res.on("finish", release);
    res.on("close", release);
    next();
  };
}

function createSocketRateLimitGuard({ bucket, windowMs, max, maxConcurrent = 0, label }) {
  return (socket) => {
    const key = getSocketClientIp(socket);
    const result = evaluateRateLimit({ bucket, key, windowMs, max });
    if (!result.allowed) {
      logRateLimitExceeded(label, key, `socket retry-after=${result.retryAfterSec}s`);
      return {
        allowed: false,
        retryAfterSec: result.retryAfterSec,
        release: () => {}
      };
    }

    if (!maxConcurrent) {
      return {
        allowed: true,
        retryAfterSec: result.retryAfterSec,
        release: () => {}
      };
    }

    if (!tryEnterConcurrentBucket(bucket, key, maxConcurrent)) {
      logRateLimitExceeded(label, key, `socket concurrent=${maxConcurrent}`);
      return {
        allowed: false,
        retryAfterSec: 1,
        release: () => {}
      };
    }

    let released = false;
    return {
      allowed: true,
      retryAfterSec: result.retryAfterSec,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        leaveConcurrentBucket(bucket, key);
      }
    };
  };
}

function cleanupSecurityState(now = Date.now()) {
  for (const store of Object.values(rateLimitBuckets)) {
    for (const [key, entry] of store) {
      if ((entry.resetAt || 0) <= now) {
        store.delete(key);
      }
    }
  }

  for (const [ip, lock] of pinLockouts) {
    if ((lock.lockUntil || 0) <= now && now - (lock.lastFailureAt || 0) > (15 * 60 * 1000)) {
      pinLockouts.delete(ip);
    }
  }
}

function resetSecurityState() {
  clearStartToken();
  pinLockouts.clear();
  for (const store of Object.values(rateLimitBuckets)) {
    store.clear();
  }
  for (const store of Object.values(concurrentLimitBuckets)) {
    store.clear();
  }
}

const securityCleanupInterval = setInterval(() => {
  cleanupSecurityState();
}, 5 * 60000);

if (typeof securityCleanupInterval.unref === "function") {
  securityCleanupInterval.unref();
}

module.exports = {
  PIN_HASH_DIGEST,
  PIN_HASH_ITERATIONS,
  RATE_LIMIT_CONFIG,
  clearPinFailures,
  clearStartToken,
  createConcurrentLimitMiddleware,
  createPinHashRecord,
  createRateLimitMiddleware,
  createSocketRateLimitGuard,
  getActiveLock,
  getClientIp,
  hasPinConfigured,
  isStartTokenValid,
  issueStartToken,
  registerPinFailure,
  resetSecurityState,
  verifyPin
};
