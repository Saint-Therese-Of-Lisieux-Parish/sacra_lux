const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPT = path.resolve(__dirname, "../../../.github/scripts/scan-release-zips.sh");

function writeExecutable(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, { mode: 0o755 });
}

function installStubs(binDir, logDir) {
  writeExecutable(path.join(binDir, "asar"), [
    "#!/bin/bash",
    "set -euo pipefail",
    'if [ "$1" != "extract" ] || [ "$#" -ne 3 ]; then',
    '  echo "unexpected asar arguments: $*" >&2',
    "  exit 1",
    "fi",
    'mkdir -p "$3"',
    'printf \'%s\\n\' \'{"name":"fixture","version":"1.0.0"}\' > "$3/package.json"'
  ]);

  writeExecutable(path.join(binDir, "syft"), [
    "#!/bin/bash",
    "set -euo pipefail",
    'src=""',
    'spdx=""',
    'cdx=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    '    dir:*) src="${1#dir:}" ;;',
    "    -o)",
    "      shift",
    '      case "$1" in',
    '        spdx-json=*) spdx="${1#spdx-json=}" ;;',
    '        cyclonedx-json=*) cdx="${1#cyclonedx-json=}" ;;',
    '        *) echo "unexpected syft output: $1" >&2; exit 1 ;;',
    "      esac",
    "      ;;",
    '    *) echo "unexpected syft argument: $1" >&2; exit 1 ;;',
    "  esac",
    "  shift",
    "done",
    'if [ -z "$src" ] || [ -z "$spdx" ] || [ -z "$cdx" ]; then',
    '  echo "syft missing arguments" >&2',
    "  exit 1",
    "fi",
    'found="$(find "$src" -type f -name package.json -print -quit)"',
    'if [ -z "$found" ]; then',
    '  echo "extracted package.json not found under $src" >&2',
    "  exit 1",
    "fi",
    'printf \'%s\\n\' \'{"bomFormat":"spdx"}\' > "$spdx"',
    'printf \'%s\\n\' \'{"bomFormat":"cyclonedx"}\' > "$cdx"',
    'printf \'%s\\n\' "$found" >> "$SYFT_LOG"'
  ]);

  writeExecutable(path.join(binDir, "grype"), [
    "#!/bin/bash",
    "set -euo pipefail",
    'json=""',
    'sarif=""',
    "saw_sbom=0",
    "saw_fail=0",
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    "    sbom:*) saw_sbom=1 ;;",
    "    --fail-on)",
    "      shift",
    '      if [ "$1" != "high" ]; then',
    '        echo "unexpected fail-on: $1" >&2',
    "        exit 1",
    "      fi",
    "      saw_fail=1",
    "      ;;",
    "    -o)",
    "      shift",
    '      case "$1" in',
    "        table) ;;",
    '        json=*) json="${1#json=}" ;;',
    '        sarif=*) sarif="${1#sarif=}" ;;',
    '        *) echo "unexpected grype output: $1" >&2; exit 1 ;;',
    "      esac",
    "      ;;",
    '    *) echo "unexpected grype argument: $1" >&2; exit 1 ;;',
    "  esac",
    "  shift",
    "done",
    'if [ "$saw_sbom" -ne 1 ] || [ "$saw_fail" -ne 1 ] || [ -z "$json" ] || [ -z "$sarif" ]; then',
    '  echo "grype missing arguments" >&2',
    "  exit 1",
    "fi",
    'printf \'%s\\n\' \'{"matches":[]}\' > "$json"',
    'printf \'%s\\n\' \'{"version":"2.1.0"}\' > "$sarif"',
    'printf \'%s\\n\' "$json" >> "$GRYPE_LOG"',
    'exit "${GRYPE_STUB_EXIT:-0}"'
  ]);

  return {
    syftLog: path.join(logDir, "syft.log"),
    grypeLog: path.join(logDir, "grype.log")
  };
}

function createZip(zipDir, fileName, files) {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "scan-zip-src-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(src, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const zipPath = path.join(zipDir, fileName);
  const result = spawnSync("zip", ["-q", "-r", zipPath, "."], { cwd: src, encoding: "utf8" });
  fs.rmSync(src, { recursive: true, force: true });
  if (result.status !== 0) {
    throw new Error(result.stderr || "zip failed");
  }
  return zipPath;
}

function runScan(args, extraEnv) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv }
  });
}

describe("scan-release-zips.sh", () => {
  let root;
  let zipDir;
  let reportDir;
  let binDir;
  let logs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "scan-release-"));
    zipDir = path.join(root, "zips");
    reportDir = path.join(root, "reports");
    binDir = path.join(root, "bin");
    fs.mkdirSync(zipDir);
    fs.mkdirSync(binDir);
    logs = installStubs(binDir, root);
    fs.writeFileSync(logs.syftLog, "");
    fs.writeFileSync(logs.grypeLog, "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function stubEnv(overrides) {
    return {
      PATH: `${binDir}:${process.env.PATH}`,
      ASAR: path.join(binDir, "asar"),
      SYFT_LOG: logs.syftLog,
      GRYPE_LOG: logs.grypeLog,
      GRYPE_STUB_EXIT: "0",
      ...overrides
    };
  }

  test("exits 2 when an argument is missing", () => {
    const result = runScan([zipDir], stubEnv());
    expect(result.status).toBe(2);
  });

  test("exits 1 when the directory has no ZIP file", () => {
    const result = runScan([zipDir, reportDir], stubEnv());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No platform ZIP file found");
  });

  test("exits 1 when a ZIP has no app.asar file", () => {
    createZip(zipDir, "Sacra-Lux-1.0.0-mac-arm64.zip", {
      "resources/readme.txt": "no archive"
    });
    const result = runScan([zipDir, reportDir], stubEnv());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No app.asar file found");
    expect(fs.existsSync(path.join(reportDir, "Sacra-Lux-1.0.0-mac-arm64.spdx.json"))).toBe(false);
  });

  test("writes both SBOM files and runs Grype on the SPDX SBOM", () => {
    createZip(zipDir, "Sacra-Lux-1.0.0-mac-arm64.zip", {
      "Sacra Lux.app/Contents/Resources/app.asar": "asar-bytes"
    });
    const result = runScan([zipDir, reportDir], stubEnv());
    expect(result.status).toBe(0);
    const spdx = path.join(reportDir, "Sacra-Lux-1.0.0-mac-arm64.spdx.json");
    const cdx = path.join(reportDir, "Sacra-Lux-1.0.0-mac-arm64.cdx.json");
    expect(fs.readFileSync(spdx, "utf8")).toContain("spdx");
    expect(fs.readFileSync(cdx, "utf8")).toContain("cyclonedx");
    const scanned = fs.readFileSync(logs.syftLog, "utf8");
    expect(scanned).toContain("app.asar.extracted");
    expect(fs.readFileSync(logs.grypeLog, "utf8")).toContain("Sacra-Lux-1.0.0-mac-arm64.grype.json");
    expect(fs.readFileSync(path.join(reportDir, "Sacra-Lux-1.0.0-mac-arm64.grype.sarif"), "utf8")).toContain("2.1.0");
  });

  test("exits 1 when Grype exits 1 and still writes the Grype reports", () => {
    createZip(zipDir, "Sacra-Lux-1.0.0-win-x64.zip", {
      "resources/app.asar": "asar-bytes"
    });
    const result = runScan([zipDir, reportDir], stubEnv({ GRYPE_STUB_EXIT: "1" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Grype failed");
    expect(fs.existsSync(path.join(reportDir, "Sacra-Lux-1.0.0-win-x64.grype.json"))).toBe(true);
    expect(fs.existsSync(path.join(reportDir, "Sacra-Lux-1.0.0-win-x64.grype.sarif"))).toBe(true);
  });
});
