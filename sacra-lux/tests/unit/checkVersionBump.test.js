const { compareVersions, parseVersion } = require("../../scripts/check-version-bump");

describe("compareVersions", () => {
  test("orders patch releases by numeric value", () => {
    expect(compareVersions("0.0.10-alpha", "0.0.9-alpha")).toBe(1);
  });

  test("treats a higher prerelease as greater", () => {
    expect(compareVersions("0.0.31-alpha", "0.0.30-alpha")).toBe(1);
    expect(compareVersions("0.0.30-alpha", "0.0.31-alpha")).toBe(-1);
  });

  test("treats a release as greater than its prerelease", () => {
    expect(compareVersions("1.0.0", "1.0.0-alpha")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0")).toBe(-1);
  });

  test("returns zero for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3-beta.1")).toBe(0);
  });

  test("orders numeric prerelease identifiers below alphanumeric ones", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-1")).toBe(1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
  });

  test("orders by major, minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
  });
});

describe("parseVersion", () => {
  test("rejects non-semver strings", () => {
    expect(parseVersion("not-a-version")).toBeNull();
    expect(parseVersion("1.2")).toBeNull();
  });
});
