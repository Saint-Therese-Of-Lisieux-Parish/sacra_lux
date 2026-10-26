const fs = require("fs");
const path = require("path");
const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("load-readings insert", () => {
  const tinyPngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=";
  let handle;
  let app;
  let state;

  function makeFolder(name, files) {
    const dir = path.join(handle.homeDir, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, file), text, "utf8");
    }
    return dir;
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-insert-") });
    app = handle.app;
    ({ state } = require("../../src/state"));
  });

  afterAll(async () => {
    await handle.stop();
  });

  test("an insert keeps the uploaded media and the existing readings", async () => {
    const first = makeFolder("insert-first", {
      "Reading_I.txt": "Genesis 1:1\n\nIn the beginning.",
      "Gospel.txt": "John 1:1\n\nIn the beginning was the Word."
    });
    const second = makeFolder("insert-second", {
      "Reading_II.txt": "Romans 1:1\n\nPaul, a servant.",
      "Gospel.txt": "Luke 1:1\n\nA second Gospel text."
    });
    await request(app).post("/api/load-readings").send({ folderPath: first }).expect(200);
    const uploaded = await request(app)
      .post("/api/upload-mass-asset")
      .send({ filename: "hymn.png", dataUrl: tinyPngDataUrl })
      .expect(200);
    await request(app).get(uploaded.body.url).expect(200);

    await request(app).post("/api/load-readings").send({ folderPath: second, insertAtIndex: 0 }).expect(200);

    await request(app).get(uploaded.body.url).expect(200);
    const docs = state.readingsSource.documents;
    expect(docs.map((doc) => doc.stem).sort()).toEqual(["Gospel", "Gospel_2", "Reading_I", "Reading_II"]);
    expect(docs.find((doc) => doc.stem === "Gospel").passage).toBe("John 1:1");
    expect(docs.find((doc) => doc.stem === "Gospel_2").passage).toBe("Luke 1:1");
    const stems = new Set(docs.map((doc) => doc.stem));
    for (const item of state.organizerSequence.filter((entry) => entry.sourceStem)) {
      expect(stems.has(item.sourceStem)).toBe(true);
    }
  });
});
