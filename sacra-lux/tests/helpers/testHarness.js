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

// Build a Mass ZIP from a folder of reading .txt files (and an optional assets/ folder).
// The Mass ZIP import is the supported way to put a Mass in place.
function buildReadingsZipData(folderPath) {
  const AdmZip = require("adm-zip");
  const { importReadings } = require("../../src/readingsImporter");
  const { createDefaultOrganizer } = require("../../src/organizer");
  const zip = new AdmZip();
  const imported = importReadings(folderPath, {});
  const organizer = createDefaultOrganizer(imported.documents || []);
  zip.addFile("settings.json", Buffer.from(JSON.stringify({
    presentationTitle: imported.title || path.basename(folderPath),
    organizerSequence: organizer.sequence,
    manualSlides: organizer.manualSlides
  })));
  for (const file of fs.readdirSync(folderPath)) {
    if (file.endsWith(".txt")) zip.addLocalFile(path.join(folderPath, file), "readings");
  }
  const assets = path.join(folderPath, "assets");
  if (fs.existsSync(assets)) {
    for (const file of fs.readdirSync(assets)) zip.addLocalFile(path.join(assets, file), "readings/assets");
  }
  return zip.toBuffer().toString("base64");
}

// Load a readings folder through a supertest app.
async function loadReadingsFolder(app, folderPath) {
  const request = require("supertest");
  const response = await request(app).post("/api/import-mass-zip").send({ zipData: buildReadingsZipData(folderPath) });
  if (response.status !== 200) {
    throw new Error(`Loading ${folderPath} failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response;
}

// Load a readings folder through a Playwright APIRequestContext.
async function loadReadingsFolderOverHttp(request, baseUrl, folderPath, headers = {}) {
  return request.post(`${baseUrl}/api/import-mass-zip`, {
    headers,
    data: { zipData: buildReadingsZipData(folderPath) }
  });
}

// Specs that share one Playwright worker also share the loaded server module.
// A start PIN from an earlier spec makes every state-changing request fail
// with 401. Drop the loaded modules so the next spec starts a clean server.
function dropLoadedServerModules() {
  const srcDir = path.resolve(__dirname, "../../src");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcDir)) {
      delete require.cache[key];
    }
  }
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
  dropLoadedServerModules,
  createTempHome,
  loadReadingsFolder,
  loadReadingsFolderOverHttp,
  makeReadingsFolder,
  startIsolatedServer
};
