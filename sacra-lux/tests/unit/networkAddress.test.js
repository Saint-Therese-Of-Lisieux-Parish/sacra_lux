const { getDefaultInterfaceName, getPreferredIpv4Address, listIpv4Addresses } = require("../../src/networkAddress");

const interfaces = {
  en0: [{ family: "IPv4", address: "10.12.0.63", internal: false }],
  en8: [{ family: "IPv4", address: "10.12.1.1", internal: false }],
  lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }]
};

describe("network address selection", () => {
  test("lists non-internal IPv4 addresses with interface names", () => {
    expect(listIpv4Addresses(interfaces)).toEqual([
      { interfaceName: "en0", address: "10.12.0.63" },
      { interfaceName: "en8", address: "10.12.1.1" }
    ]);
  });

  test("reads the default interface on macOS", () => {
    const exec = jest.fn(() => "   route to: default\ninterface: en8\n");
    expect(getDefaultInterfaceName({ platform: "darwin", exec })).toBe("en8");
    expect(exec).toHaveBeenCalledWith("route", ["-n", "get", "default"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  });

  test("prefers the address on the default-route interface", () => {
    expect(getPreferredIpv4Address({ networkInterfaces: interfaces, defaultInterfaceName: "en8" }))
      .toBe("10.12.1.1");
  });

  test("uses a saved address when it still exists", () => {
    expect(getPreferredIpv4Address({
      selectedAddress: "10.12.0.63",
      networkInterfaces: interfaces,
      defaultInterfaceName: "en8"
    })).toBe("10.12.0.63");
  });

  test("falls back when a saved address no longer exists", () => {
    expect(getPreferredIpv4Address({
      selectedAddress: "10.12.9.9",
      networkInterfaces: interfaces,
      defaultInterfaceName: "en8"
    })).toBe("10.12.1.1");
  });
});
