const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const sharp = require("sharp");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

const TWO_FRAME_GIF = "R0lGODlhAgACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAgACAAACAoRRACH5BAAKAAAALAAAAAACAAIAgAAA/wAAAAIChFEAOw==";

describe("compressing a Mass archive", () => {
  let handle;
  let app;
  let massHistory;
  let entries;
  let archive;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-compress-") });
    app = handle.app;
    massHistory = require("../../src/massHistory");

    await request(app).post("/api/new-mass").send({ title: "Mass A", startTime: "2026-04-01T09:00" }).expect(200);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } }).png().toBuffer();
    const image = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "photo.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` })
      .expect(200);
    const animatedImage = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "animated.gif", dataUrl: `data:image/gif;base64,${TWO_FRAME_GIF}` })
      .expect(200);
    const movie = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "clip.mp4", dataUrl: `data:video/mp4;base64,${Buffer.from("not a real movie").toString("base64")}` })
      .expect(200);
    await request(app)
      .post("/api/organizer")
      .send({
        sequence: [
          { id: "image-1", type: "image", label: "Image", phase: "pre", backgroundTheme: "light" },
          { id: "animated-image", type: "image", label: "Animated image", phase: "pre", backgroundTheme: "light" },
          { id: "movie-1", type: "movie", label: "Movie", phase: "pre", backgroundTheme: "dark" }
        ],
        manualSlides: {
          "image-1": { text: "Image", imageUrl: image.body.url },
          "animated-image": { text: "Animated image", imageUrl: animatedImage.body.url },
          "movie-1": { videoUrl: movie.body.url }
        }
      })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));

    const { packageDir, compressedZipPath } = massHistory.getArchivePaths("Mass-A");
    await request(app).post("/api/new-mass").send({ title: "Mass B", startTime: "2026-04-02T09:00" }).expect(200);
    fs.writeFileSync(path.join(packageDir, "assets", "unused.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    await request(app).post("/api/mass-history/Mass-A/compress").expect(200);
    archive = new AdmZip(compressedZipPath);
    entries = archive.getEntries().map((entry) => entry.entryName);
  }, 60000);

  afterAll(async () => {
    await handle.stop();
  });

  test("keeps the AVIF copy and drops the converted original", () => {
    expect(entries).toContain("assets/photo.avif");
    expect(entries).not.toContain("assets/photo.png");
  });

  test("keeps the original when AVIF conversion loses animation frames", async () => {
    expect(entries).toContain("assets/animated.gif");
    expect(entries).not.toContain("assets/animated.avif");
    await expect(sharp(archive.getEntry("assets/animated.gif").getData()).metadata()).resolves.toMatchObject({ pages: 2 });
  });

  test("keeps assets that it did not convert", () => {
    expect(entries).toContain("assets/clip.mp4");
    expect(entries).toContain("assets/unused.svg");
    expect(entries).toContain("mass.json");
  });
});
