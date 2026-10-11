const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const configuredAppPath = process.env.SMOKE_APP_PATH;

if (!configuredAppPath) {
  console.error("SMOKE_APP_PATH is required (path to the packaged app executable).");
  process.exit(1);
}

const appPath = path.resolve(configuredAppPath);

if (!fs.existsSync(appPath)) {
  console.error(`Packaged app executable not found at ${appPath}.`);
  process.exit(1);
}

const port = Number(process.env.SACRA_LUX_PORT || "17841");
const stateUrl = `http://127.0.0.1:${port}/api/state`;
const TIMEOUT_MS = 90_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchState() {
  return new Promise((resolve, reject) => {
    const request = http.get(stateUrl, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`unexpected HTTP status ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);
    request.setTimeout(2_000, () => request.destroy(new Error("request timed out")));
  });
}

async function waitForState() {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError = new Error("no response yet");

  while (Date.now() < deadline) {
    try {
      return await fetchState();
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }

  throw lastError;
}

async function main() {
  console.log(`Launching packaged app: ${appPath}`);
  const child = spawn(appPath, [], {
    env: { ...process.env, SACRA_LUX_PORT: String(port) },
    stdio: "inherit"
  });

  let exitCode = null;
  child.on("exit", (code) => {
    exitCode = code;
  });

  try {
    const state = await waitForState();

    if (exitCode !== null) {
      throw new Error(`packaged app exited early with code ${exitCode}`);
    }

    if (!state || typeof state !== "object" || !("presentation" in state)) {
      throw new Error("unexpected /api/state payload");
    }

    console.log(`Packaged app smoke passed: /api/state responded on port ${port}.`);
    child.kill("SIGTERM");
    process.exit(0);
  } catch (error) {
    console.error(`Packaged app smoke failed: ${error.message}`);
    try {
      child.kill("SIGKILL");
    } catch (_ignored) {
      process.exitCode = 1;
    }
    process.exit(1);
  }
}

main();
