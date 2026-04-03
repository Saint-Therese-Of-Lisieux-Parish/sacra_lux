const fs = require("fs");
const os = require("os");
const path = require("path");

function createTempHome(prefix = "sacra-lux-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeReadingsFolder(rootDir) {
  const folder = path.join(rootDir, "readings");
  fs.mkdirSync(folder, { recursive: true });

  const files = {
    "mass_title.txt": "Sunday Mass",
    "Reading_I.txt": "Genesis 1:1-3\n\nIn the beginning God created the heavens and the earth.",
    "Responsorial_Psalm.txt": "Psalm 23\n\nR. The Lord is my shepherd; there is nothing I shall want.\nHe guides me along right paths.\nR. The Lord is my shepherd; there is nothing I shall want.",
    "Gospel.txt": "John 1:1-5\n\nIn the beginning was the Word.\nAnd the Word was with God."
  };

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(folder, name), contents, "utf8");
  }

  return folder;
}

function waitForListening(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    server.on("error", onError);
    server.on("listening", onListening);
  });
}

async function startIsolatedServer({ port = 0, homeDir } = {}) {
  const chosenHome = homeDir || createTempHome();
  process.env.HOME = chosenHome;

  const { startServer } = require("../../src/server");
  const handle = startServer(port, { quietLogs: true });

  await waitForListening(handle.server);
  const address = handle.server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    ...handle,
    homeDir: chosenHome,
    baseUrl: `http://127.0.0.1:${actualPort}`,
    async stop() {
      if (typeof handle.close === "function") {
        await handle.close();
        return;
      }

      if (handle.server.listening) {
        await new Promise((resolve, reject) => {
          handle.server.close((err) => {
            if (err && !/not running/i.test(String(err.message || ""))) {
              reject(err);
              return;
            }
            resolve();
          });
        });
      }
      await new Promise((resolve) => handle.io.close(resolve));
    }
  };
}

module.exports = {
  createTempHome,
  makeReadingsFolder,
  startIsolatedServer
};
