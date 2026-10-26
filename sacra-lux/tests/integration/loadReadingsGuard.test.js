const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

function lanAddress() {
  for (const infos of Object.values(os.networkInterfaces())) {
    const found = (infos || []).find((info) => info.family === "IPv4" && !info.internal);
    if (found) return found.address;
  }
  return null;
}

describe("load-readings access and folder limits", () => {
  let handle;
  let app;
  let homeDir;

  function makeFolder(name, files) {
    const folder = path.join(homeDir, name);
    fs.mkdirSync(path.join(folder, "assets"), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(folder, file), content);
    }
    return folder;
  }

  beforeAll(async () => {
    jest.resetModules();
    homeDir = createTempHome("sacra-lux-load-guard-");
    handle = await startIsolatedServer({ port: 0, homeDir });
    app = handle.app;
  });

  afterAll(async () => {
    await handle.stop();
  });

  test("the loopback operator loads a folder and only .txt and media files are copied", async () => {
    const folder = makeFolder("mixed", {
      "Gospel.txt": "John 1:1\n\nIn the beginning was the Word.",
      "notes.docx": "not a reading",
      "assets/photo.png": "png",
      "assets/secret.pem": "key"
    });
    await request(app).post("/api/load-readings").send({ folderPath: folder }).expect(200);

    const massDir = path.join(homeDir, ".sacra-lux", "current_mass");
    expect(fs.existsSync(path.join(massDir, "Gospel.txt"))).toBe(true);
    expect(fs.existsSync(path.join(massDir, "notes.docx"))).toBe(false);
    expect(fs.existsSync(path.join(massDir, "assets", "photo.png"))).toBe(true);
    expect(fs.existsSync(path.join(massDir, "assets", "secret.pem"))).toBe(false);
  });

  test("a folder with 201 files is rejected and current_mass stays as it was", async () => {
    const files = {};
    for (let i = 0; i < 201; i += 1) files[`R${i}.txt`] = `Reading ${i}\n\nText.`;
    const folder = makeFolder("too-many", files);
    const massDir = path.join(homeDir, ".sacra-lux", "current_mass");
    const before = fs.readdirSync(massDir).sort();

    const response = await request(app).post("/api/load-readings").send({ folderPath: folder });
    expect(response.status).toBe(400);
    expect(fs.readdirSync(massDir).sort()).toEqual(before);
  });

  test("a client on a LAN address is rejected with 403", async () => {
    const address = lanAddress();
    if (!address) return; // No non-loopback interface on this machine.
    const folder = makeFolder("lan", { "Gospel.txt": "John 1:1\n\nText." });
    // Trusted-LAN control gives the LAN client a control session, so only the route guard can refuse it.
    await request(app).post("/api/control-mode").send({ mode: "trusted-lan" }).expect(200);
    const response = await request(`http://${address}:${handle.server.address().port}`)
      .post("/api/load-readings")
      .send({ folderPath: folder });
    expect(response.status).toBe(403);
  });
});
