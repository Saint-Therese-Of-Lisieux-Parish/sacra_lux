const net = require("net");
const os = require("os");

/**
 * Host and Origin checks.
 * They block DNS rebinding and cross-site requests to the local server.
 *
 * An allowed host is one of:
 * - localhost or a loopback address
 * - an address of a network interface on this computer
 * - an IPv4 address inside a network from SACRA_LUX_ALLOWED_NETWORKS (CIDR, such as 192.168.1.0/24)
 * - a host name from SACRA_LUX_ALLOWED_NETWORKS (such as sacra.local)
 */

const ALLOWED_NETWORKS_ENV = "SACRA_LUX_ALLOWED_NETWORKS";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Return the host name of a Host header or an Origin value, or "" when it is not valid.
function parseHostname(value, { origin = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(origin ? text : `http://${text}`);
    if (origin && !/^https?:$/.test(url.protocol)) return "";
    if (!url.hostname || url.username || url.password) return "";
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function stripIpv6Brackets(hostname) {
  return hostname.replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackHost(hostname) {
  const ip = stripIpv6Brackets(hostname);
  return hostname === "localhost" || ip === "::1" || (net.isIPv4(ip) && ip.startsWith("127."));
}

function listLocalAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const info of entries || []) addresses.push(info.address);
  }
  return addresses;
}

const HOSTNAME_LABEL = /^[a-z0-9-]{1,63}$/i;

function isValidHostname(value) {
  return value.length <= 253 && value.split(".").every(
    (label) => HOSTNAME_LABEL.test(label) && !label.startsWith("-") && !label.endsWith("-")
  );
}

// Split the configured list. Return the networks, the host names, and the entries that are not valid.
function parseAllowedEntries(rawValue) {
  const networks = new net.BlockList();
  const hostnames = new Set();
  const invalid = [];
  for (const entry of String(rawValue || "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [address, prefixText, extra] = entry.split("/");
    if (net.isIPv4(address)) {
      const prefix = prefixText === undefined ? 32 : Number(prefixText);
      if (extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        invalid.push(entry);
        continue;
      }
      networks.addSubnet(address, prefix, "ipv4");
    } else if (prefixText === undefined && isValidHostname(entry)) {
      hostnames.add(entry.toLowerCase());
    } else {
      invalid.push(entry);
    }
  }
  return { networks, hostnames, invalid };
}

function createHostGuard({ allowedEntries = process.env[ALLOWED_NETWORKS_ENV], getLocalAddresses = listLocalAddresses, onInvalidEntry = () => {} } = {}) {
  const { networks, hostnames, invalid } = parseAllowedEntries(allowedEntries);
  for (const entry of invalid) onInvalidEntry(entry);

  function isHostnameAllowed(hostname) {
    if (!hostname) return false;
    if (isLoopbackHost(hostname)) return true;
    if (hostnames.has(hostname)) return true;
    const ip = stripIpv6Brackets(hostname);
    if (!net.isIP(ip)) return false;
    if (net.isIPv4(ip) && networks.check(ip, "ipv4")) return true;
    return getLocalAddresses().some((address) => address.toLowerCase() === ip.toLowerCase());
  }

  function isHostAllowed(hostHeader) {
    return isHostnameAllowed(parseHostname(hostHeader));
  }

  // A missing Origin is allowed. Native clients and same-origin GET requests do not send one.
  function isOriginAllowed(origin) {
    if (origin === undefined || origin === "") return true;
    return isHostnameAllowed(parseHostname(origin, { origin: true }));
  }

  // Browsers set Sec-Fetch-Site on every request. A page from another site sets "cross-site".
  function isCrossSite(req) {
    return String(req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site";
  }

  function middleware(req, res, next) {
    if (!isHostAllowed(req.headers.host)) {
      return res.status(403).json({ error: "Host not allowed." });
    }
    if (!SAFE_METHODS.has(req.method) && !isOriginAllowed(req.headers.origin)) {
      return res.status(403).json({ error: "Origin not allowed." });
    }
    if (!SAFE_METHODS.has(req.method) && isCrossSite(req)) {
      return res.status(403).json({ error: "Cross-site request not allowed." });
    }
    return next();
  }

  // Socket.IO allowRequest callback. It checks every handshake, not only state changes.
  function allowRequest(req, callback) {
    callback(null, isHostAllowed(req.headers.host) && isOriginAllowed(req.headers.origin));
  }

  return { isCrossSite, isHostAllowed, isOriginAllowed, middleware, allowRequest };
}

function normalizeClientAddress(value) {
  const address = String(value || "").replace(/^::ffff:/i, "");
  return address;
}

function isLoopbackAddress(value) {
  const address = normalizeClientAddress(value);
  return address === "::1" || /^127\./.test(address);
}

function parseSourceNetworkEntries(rawValue) {
  const networks = new net.BlockList();
  const entries = [];
  const invalid = [];
  for (const entry of String(rawValue || "").split(",").map((part) => part.trim()).filter(Boolean)) {
    const [address, prefixText, extra] = entry.split("/");
    const family = net.isIP(address);
    const prefix = prefixText === undefined ? (family === 4 ? 32 : family === 6 ? 128 : NaN) : Number(prefixText);
    const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
    if (!family || extra !== undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      invalid.push(entry);
      continue;
    }
    networks.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    entries.push(entry);
  }
  return { networks, entries, invalid };
}

function createSourceNetworkGuard({ allowedEntries = process.env.SACRA_LUX_SOURCE_NETWORKS, onInvalidEntry = () => {} } = {}) {
  let parsed = parseSourceNetworkEntries(allowedEntries);
  for (const entry of parsed.invalid) onInvalidEntry(entry);

  function setAllowedEntries(value) {
    const next = parseSourceNetworkEntries(value);
    if (next.invalid.length) return next;
    parsed = next;
    return next;
  }

  function isAllowedAddress(value) {
    if (isLoopbackAddress(value) || !parsed.entries.length) return true;
    const address = normalizeClientAddress(value);
    const family = net.isIP(address);
    return family > 0 && parsed.networks.check(address, family === 4 ? "ipv4" : "ipv6");
  }

  function middleware(req, res, next) {
    if (!isAllowedAddress(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip)) {
      return res.status(403).json({ error: "Source network not allowed." });
    }
    return next();
  }

  function allowRequest(req, callback) {
    callback(null, isAllowedAddress(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip));
  }

  return {
    allowRequest,
    get entries() { return [...parsed.entries]; },
    isAllowedAddress,
    middleware,
    parse: parseSourceNetworkEntries,
    setAllowedEntries
  };
}

module.exports = {
  ALLOWED_NETWORKS_ENV,
  createHostGuard,
  createSourceNetworkGuard,
  normalizeClientAddress,
  parseAllowedEntries,
  parseSourceNetworkEntries
};
