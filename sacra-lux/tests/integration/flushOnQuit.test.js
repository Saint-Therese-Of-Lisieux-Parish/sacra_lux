const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const WEB_ENTRY = path.join(__dirname, "../../src/web.js");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function postJson(port, route, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.once("error", reject);
    req.end(data);
  });
}

function getJson(port, route) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: route }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve(JSON.parse(text)));
      })
      .once("error", reject);
  });
}

async function startWeb(home, port) {
  const child = spawn(process.execPath, [WEB_ENTRY], {
    env: { ...process.env, HOME: home, USERPROFILE: home, PORT: String(port) },
    stdio: "ignore"
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await getJson(port, "/api/state");
      return { child, exited };
    } catch {
      await wait(100);
    }
  }
  child.kill("SIGKILL");
  throw new Error("The headless server did not start.");
}

describe("saving on quit", () => {
  test.each(["SIGTERM", "SIGINT"])("%s writes a pending save before the server exits", async (signal) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-quit-"));
    const port = await freePort();
    const first = await startWeb(home, port);
    try {
      expect(await postJson(port, "/api/new-mass", { title: "First title", startTime: "" })).toBe(200);
      await wait(1500);
      expect(await postJson(port, "/api/update-title", { title: "Edited just before quit" })).toBe(200);
      await wait(200);
      first.child.kill(signal);
      await first.exited;
    } finally {
      first.child.kill("SIGKILL");
    }

    const second = await startWeb(home, port);
    try {
      const state = await getJson(port, "/api/state");
      expect(state.presentation.title).toBe("Edited just before quit");
    } finally {
      second.child.kill("SIGKILL");
      await second.exited;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 30000);
});
