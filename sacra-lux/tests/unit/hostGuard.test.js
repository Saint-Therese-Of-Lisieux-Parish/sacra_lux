const { createHostGuard, createSourceNetworkGuard, parseAllowedEntries } = require("../../src/hostGuard");

const LOCAL = ["192.168.50.7", "fe80::1"];

function guard(allowedEntries, onInvalidEntry) {
  return createHostGuard({ allowedEntries, getLocalAddresses: () => LOCAL, onInvalidEntry });
}

describe("host guard hosts", () => {
  test.each([
    "localhost",
    "localhost:17841",
    "LOCALHOST.:17841",
    "127.0.0.1:17841",
    "127.5.5.5",
    "[::1]:17841",
    "192.168.50.7:17841"
  ])("allows %s with no configuration", (host) => {
    expect(guard("").isHostAllowed(host)).toBe(true);
  });

  test.each([
    "evil.example",
    "evil.example:17841",
    "10.0.0.5:17841",
    "192.168.1.20:17841",
    "localhost.evil.example",
    "127.0.0.1.evil.example",
    "user@localhost",
    "",
    undefined
  ])("rejects %s with no configuration", (host) => {
    expect(guard("").isHostAllowed(host)).toBe(false);
  });

  test("allows addresses inside a configured network", () => {
    const g = guard("192.168.1.0/24, 10.12.0.0/21");
    expect(g.isHostAllowed("192.168.1.200:17841")).toBe(true);
    expect(g.isHostAllowed("10.12.7.255")).toBe(true);
    expect(g.isHostAllowed("192.168.2.1")).toBe(false);
    expect(g.isHostAllowed("10.12.8.1")).toBe(false);
  });

  test("allows a single address and a configured host name", () => {
    const g = guard("172.16.4.9,sacra.local");
    expect(g.isHostAllowed("172.16.4.9:17841")).toBe(true);
    expect(g.isHostAllowed("172.16.4.10")).toBe(false);
    expect(g.isHostAllowed("Sacra.local:17841")).toBe(true);
    expect(g.isHostAllowed("other.local")).toBe(false);
  });

  test("reports and ignores invalid entries", () => {
    const invalid = jest.fn();
    const g = guard("192.168.1.0/33,not a host,10.0.0.0/8/1,192.168.9.0/24", invalid);
    expect(invalid.mock.calls.map((call) => call[0])).toEqual([
      "192.168.1.0/33",
      "not a host",
      "10.0.0.0/8/1"
    ]);
    expect(g.isHostAllowed("192.168.9.4")).toBe(true);
    expect(g.isHostAllowed("192.168.1.4")).toBe(false);
  });

  test("parseAllowedEntries returns empty sets for no value", () => {
    const parsed = parseAllowedEntries(undefined);
    expect(parsed.hostnames.size).toBe(0);
    expect(parsed.invalid).toEqual([]);
  });
});

describe("host guard origins", () => {
  const g = guard("192.168.1.0/24");

  test("allows a missing Origin", () => {
    expect(g.isOriginAllowed(undefined)).toBe(true);
  });

  test.each([
    "http://localhost:17841",
    "http://127.0.0.1:17841",
    "http://[::1]:17841",
    "http://192.168.1.44:17841",
    "https://192.168.50.7"
  ])("allows %s", (origin) => {
    expect(g.isOriginAllowed(origin)).toBe(true);
  });

  test.each([
    "https://evil.example",
    "http://192.168.2.1:17841",
    "null",
    "file://localhost/",
    "not a url"
  ])("rejects %s", (origin) => {
    expect(g.isOriginAllowed(origin)).toBe(false);
  });
});

describe("source network guard", () => {
  test.each([
    ["192.168.1.7", "192.168.1.7"],
    ["192.168.1.7", "192.168.1.0/24"],
    ["2001:db8::7", "2001:db8::/64"],
    ["::ffff:192.168.1.7", "192.168.1.0/24"]
  ])("allows %s in %s", (address, allowed) => {
    expect(createSourceNetworkGuard({ allowedEntries: allowed }).isAllowedAddress(address)).toBe(true);
  });

  test("rejects an address outside the allowlist", () => {
    const guard = createSourceNetworkGuard({ allowedEntries: "192.168.1.0/24" });
    expect(guard.isAllowedAddress("192.168.2.1")).toBe(false);
  });

  test("reports malformed IPv4 and IPv6 entries", () => {
    expect(createSourceNetworkGuard({ allowedEntries: "192.168.1.0/33,2001:db8::/129" }).entries).toEqual([]);
    expect(createSourceNetworkGuard({ allowedEntries: "192.168.1.0/33,2001:db8::/129" }).parse("x").invalid).toEqual(["x"]);
  });

  test("allows all addresses when the allowlist is empty", () => {
    expect(createSourceNetworkGuard({ allowedEntries: "" }).isAllowedAddress("203.0.113.10")).toBe(true);
  });
});

describe("host guard middleware", () => {
  function run(req) {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();
    guard("").middleware({ headers: {}, ...req }, res, next);
    return { res, next };
  }

  test("rejects a foreign Host with 403", () => {
    const { res, next } = run({ method: "GET", headers: { host: "evil.example" } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects a foreign Origin on a state-changing request", () => {
    const { res, next } = run({ method: "POST", headers: { host: "localhost:1", origin: "https://evil.example" } });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("does not check Origin on a read request", () => {
    const { next } = run({ method: "GET", headers: { host: "localhost:1", origin: "https://evil.example" } });
    expect(next).toHaveBeenCalled();
  });

  test("allows a request with no Origin", () => {
    const { next } = run({ method: "POST", headers: { host: "localhost:1" } });
    expect(next).toHaveBeenCalled();
  });

  test("allowRequest rejects a foreign Origin and accepts a local one", () => {
    const g = guard("");
    const callback = jest.fn();
    g.allowRequest({ headers: { host: "localhost:1", origin: "https://evil.example" } }, callback);
    g.allowRequest({ headers: { host: "localhost:1", origin: "http://localhost:1" } }, callback);
    g.allowRequest({ headers: { host: "evil.example" } }, callback);
    expect(callback.mock.calls).toEqual([[null, false], [null, true], [null, false]]);
  });
});
