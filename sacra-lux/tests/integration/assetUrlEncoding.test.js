const AdmZip = require("adm-zip");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=";

describe("Mass asset URLs with # and % in the file name", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-asset-url-") });
    app = handle.app;
    await request(app).post("/api/new-mass").send({ title: "Encoding", startTime: "2026-04-20T09:00" }).expect(200);
  });

  afterAll(async () => {
    await handle.stop();
  });

  test.each([
    ["Hymn #1.png", "/api/mass-asset/Hymn%20%231.png"],
    ["50% off.png", "/api/mass-asset/50%25%20off.png"]
  ])("%s returns an encoded URL that serves the file", async (filename, expectedUrl) => {
    const upload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename, dataUrl: tinyPngDataUrl })
      .expect(200);
    expect(upload.body.url).toBe(expectedUrl);

    const served = await request(app).get(upload.body.url).expect(200);
    expect(served.headers["content-type"]).toMatch(/image\/png/);

    const listed = await request(app).get("/api/mass-assets?kind=image").expect(200);
    expect(listed.body.assets.find((a) => a.name === filename).url).toBe(expectedUrl);
  });

  test("the Mass ZIP contains an image whose name has # and %", async () => {
    const upload = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "Zip #2 100%.png", dataUrl: tinyPngDataUrl })
      .expect(200);

    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [{ id: "text-1", type: "text", label: "Welcome", phase: "pre", backgroundTheme: "dark" }],
        manualSlides: { "text-1": { text: "Welcome", notes: "", textVAlign: "middle", imageUrl: upload.body.url } }
      })
      .expect(200);

    const zipRes = await request(app)
      .get("/api/export-mass-zip")
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const entries = new AdmZip(zipRes.body).getEntries().map((e) => e.entryName);
    expect(entries).toContain("assets/Zip #2 100%.png");
  });
});
