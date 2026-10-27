const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WEB_ENTRY = path.join(__dirname, "..", "..", "src", "web.js");
const PORT = "17899";

describe("web mode port in use", () => {
  let home;
  let first;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-port-"));
    first = spawn(process.execPath, [WEB_ENTRY], {
      env: { ...process.env, PORT, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("first server did not start")), 15000);
      first.stdout.on("data", (chunk) => {
        if (String(chunk).includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      first.once("exit", () => reject(new Error("first server exited")));
    });
  });

  afterAll(() => {
    if (first) first.kill("SIGTERM");
    if (home) fs.rmSync(home, { recursive: true, force: true });
  });

  test("a second server prints one plain line and exits non-zero without a stack trace", () => {
    const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-port2-"));
    try {
      const result = spawnSync(process.execPath, [WEB_ENTRY], {
        env: { ...process.env, PORT, HOME: home2, USERPROFILE: home2 },
        encoding: "utf8",
        timeout: 15000
      });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(output).toContain(PORT);
      expect(output).toContain("PORT");
      expect(output).not.toMatch(/^\s+at /m);
    } finally {
      fs.rmSync(home2, { recursive: true, force: true });
    }
  });
});
