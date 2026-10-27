const fs = require("fs");
const path = require("path");
const { io: createClient } = require("socket.io-client");
const request = require("supertest");

const {
  createTempHome,
  loadReadingsFolder,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("reading persistence", () => {
  let homeDir;

  async function boot() {
    jest.resetModules();
    return startIsolatedServer({ port: 0, homeDir });
  }

  beforeEach(() => {
    homeDir = createTempHome("sacra-lux-reading-persistence-");
  });

  test("a saved reading remains after a server restart", async () => {
    const first = await boot();
    const readingsDir = makeReadingsFolder(homeDir);
    await loadReadingsFolder(first.app, readingsDir);

    await request(first.app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "The saved reading text." })
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const restarted = await boot();
    try {
      const state = (await request(restarted.app).get("/api/state").expect(200)).body;
      const reading = state.readingsSource.documents.find((entry) => entry.stem === "Reading_I");
      expect(reading.textLines).toContain("The saved reading text.");
    } finally {
      await restarted.stop();
    }
  });

  test.each([
    ["missing", { stem: "Reading_I" }],
    ["a number", { stem: "Reading_I", text: 42 }]
  ])("save-reading rejects text that is %s and keeps the file", async (_label, body) => {
    const first = await boot();
    try {
      const readingsDir = makeReadingsFolder(homeDir);
      await loadReadingsFolder(first.app, readingsDir);
      const before = (await request(first.app).get("/api/state").expect(200)).body;
      const beforeDoc = before.readingsSource.documents.find((entry) => entry.stem === "Reading_I");

      await request(first.app).post("/api/save-reading").send(body).expect(400);

      const after = (await request(first.app).get("/api/state").expect(200)).body;
      const afterDoc = after.readingsSource.documents.find((entry) => entry.stem === "Reading_I");
      expect(afterDoc.textLines).toEqual(beforeDoc.textLines);
      expect(JSON.stringify(afterDoc.textLines)).not.toContain("undefined");
    } finally {
      await first.stop();
    }
  });

  describe("save-reading keeps live state", () => {
    let handle;
    let client;

    beforeEach(async () => {
      handle = await boot();
      const readingsDir = makeReadingsFolder(homeDir);
      const longText = Array.from({ length: 300 }, (_, n) => `Line ${n} of a long Gospel.`).join("\n");
      fs.writeFileSync(path.join(readingsDir, "Gospel.txt"), `John 1:1-5\n\n${longText}`, "utf8");
      await loadReadingsFolder(handle.app, readingsDir);
    });

    afterEach(async () => {
      if (client) {
        client.close();
        client = null;
      }
      await handle.stop();
    });

    async function connect() {
      client = createClient(handle.baseUrl, { transports: ["websocket"] });
      await new Promise((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
    }

    async function getState() {
      return (await request(handle.app).get("/api/state").expect(200)).body;
    }

    test("keeps a title set just before the save", async () => {
      await request(handle.app).post("/api/update-title").send({ title: "New Title" }).expect(200);
      await request(handle.app).post("/api/save-reading").send({ stem: "Reading_I", text: "Short." }).expect(200);
      expect((await getState()).presentation.title).toBe("New Title");
    });

    test("keeps an empty title", async () => {
      await request(handle.app).post("/api/update-title").send({ title: "" }).expect(200);
      await request(handle.app).post("/api/save-reading").send({ stem: "Reading_I", text: "Short." }).expect(200);
      expect((await getState()).presentation.title).toBe("");
    });

    test("moves the slide index into range when the reading gets shorter", async () => {
      await connect();
      const total = (await getState()).presentation.slides.length;
      client.emit("slide:goto", total - 1);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect((await getState()).currentSlideIndex).toBe(total - 1);

      const updated = new Promise((resolve) => {
        client.on("state:update", (snapshot) => {
          if (snapshot.presentation.slides.length < total) {
            resolve(snapshot);
          }
        });
      });
      await request(handle.app).post("/api/save-reading").send({ stem: "Gospel", text: "Short." }).expect(200);
      const snapshot = await updated;
      expect(snapshot.currentSlideIndex).toBeLessThan(snapshot.presentation.slides.length);
    });
  });
});
