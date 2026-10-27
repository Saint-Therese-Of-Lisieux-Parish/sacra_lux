const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const fc = require("fast-check");
const request = require("supertest");

const { startIsolatedServer } = require("../helpers/testHarness");

const MIN_MASS_JSON = JSON.stringify({
  format: "sacra-lux.mass",
  version: 3,
  metadata: { title: "Fuzz Mass" },
  items: []
});

function toDataUrl(zip) {
  return `data:application/zip;base64,${zip.toBuffer().toString("base64")}`;
}

function listFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else found.push(full);
  }
  return found;
}

describe("ZIP import fuzzing", () => {
  let handle;
  let app;
  let sandboxDir;
  let homeDir;
  let MASS_ZIP_LIMITS;

  beforeAll(async () => {
    jest.resetModules();
    // The home folder sits in its own sandbox. A file written outside the
    // home folder appears next to it and fails the test.
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "sacra-lux-zipfuzz-"));
    homeDir = path.join(sandboxDir, "home");
    fs.mkdirSync(homeDir);
    handle = await startIsolatedServer({ port: 0, homeDir });
    app = handle.app;
    app.set("trust proxy", true);
    ({ MASS_ZIP_LIMITS } = require("../../src/server"));
  });

  afterAll(async () => {
    await handle.stop();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  test("entry names that leave the package folder never write outside the home folder", async () => {
    const segment = fc.constantFrom("..", ".", "..\\", "\\..", "a", "x.txt", "evil.txt", "%2e%2e", "C:", "");
    const separator = fc.constantFrom("/", "\\", "//");
    const hostileName = fc.tuple(
      fc.constantFrom("", "/", "\\", "readings/", "readings/assets/", "assets/", "uploads/"),
      fc.array(fc.tuple(segment, separator), { minLength: 1, maxLength: 4 }),
      fc.constantFrom("evil.txt", "evil.png", "mass.json")
    ).map(([prefix, parts, leaf]) => `${prefix}${parts.map(([part, sep]) => `${part}${sep}`).join("")}${leaf}`);

    let ipCounter = 0;
    await fc.assert(
      fc.asyncProperty(hostileName, async (name) => {
        const zip = new AdmZip();
        zip.addFile("mass.json", Buffer.from(MIN_MASS_JSON));
        zip.addFile(name, Buffer.from("hostile"));
        ipCounter += 1;

        const response = await request(app)
          .post("/api/import-mass-zip")
          .set("X-Forwarded-For", `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`)
          .send({ zipData: toDataUrl(zip) });

        expect([200, 400]).toContain(response.status);
        expect(fs.readdirSync(sandboxDir)).toEqual(["home"]);
        // A valid `readings/evil.txt` entry lands inside a Mass package. The
        // package may also be copied into the Mass history, so allow nested
        // copies. An escaped write lands directly in the data or home folder.
        const escapeFolders = [homeDir, path.join(homeDir, ".sacra-lux")];
        expect(listFiles(homeDir).some((file) => path.basename(file) === "evil.txt" &&
          escapeFolders.includes(path.dirname(file)))).toBe(false);
      }),
      { numRuns: 60 }
    );
  });

  test("a small ZIP that expands past the uncompressed limit is rejected", async () => {
    const zip = new AdmZip();
    zip.addFile("mass.json", Buffer.from(MIN_MASS_JSON));
    // Zeros compress to a tiny archive. The entries together exceed the limit.
    const entryCount = Math.floor(MASS_ZIP_LIMITS.maxUncompressedBytes / MASS_ZIP_LIMITS.maxEntryBytes);
    const block = Buffer.alloc(MASS_ZIP_LIMITS.maxEntryBytes);
    for (let index = 0; index < entryCount; index += 1) {
      zip.addFile(`assets/zero-${index}.png`, block);
    }
    zip.addFile("assets/overflow.png", Buffer.alloc(1024));
    const encoded = toDataUrl(zip);
    expect(Buffer.byteLength(encoded)).toBeLessThan(MASS_ZIP_LIMITS.maxCompressedBytes);

    const response = await request(app)
      .post("/api/import-mass-zip")
      .set("X-Forwarded-For", "10.2.0.1")
      .send({ zipData: encoded });

    expect(response.status).toBe(400);
    expect(String(response.body.error || "")).toMatch(/uncompressed size exceeds/i);
  }, 120000);
});
