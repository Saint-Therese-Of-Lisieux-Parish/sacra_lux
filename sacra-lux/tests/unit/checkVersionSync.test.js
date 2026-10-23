const fs = require("fs");
const os = require("os");
const path = require("path");
const { findDocVersionErrors } = require("../../scripts/check-version-sync");

function writeDocs(rootDir, readmeVersion, infoVersion) {
  fs.mkdirSync(path.join(rootDir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(rootDir, "README.md"), `## Current Version\n\nThe current package version is \`${readmeVersion}\`.\n`);
  fs.writeFileSync(path.join(rootDir, "docs", "codebase_info.md"), `- package: \`sacra-lux\`\n- version: \`${infoVersion}\`\n`);
}

describe("findDocVersionErrors", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "version-sync-"));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  test("passes when every doc field matches the package version", () => {
    writeDocs(rootDir, "0.0.116-alpha", "0.0.116-alpha");
    expect(findDocVersionErrors("0.0.116-alpha", rootDir)).toEqual([]);
  });

  test("reports each doc field that differs", () => {
    writeDocs(rootDir, "0.0.28-alpha", "0.0.32-alpha");
    const errors = findDocVersionErrors("0.0.116-alpha", rootDir);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("README.md");
    expect(errors[1]).toContain("codebase_info.md");
  });

  test("reports a missing version field", () => {
    writeDocs(rootDir, "0.0.116-alpha", "0.0.116-alpha");
    fs.writeFileSync(path.join(rootDir, "README.md"), "No version here.\n");
    expect(findDocVersionErrors("0.0.116-alpha", rootDir)).toEqual([
      "README.md: current-version field not found"
    ]);
  });
});
