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

  test("keeps a reading file edit that is newer than mass.json at startup", async () => {
    const first = await boot();
    const readingsDir = makeReadingsFolder(homeDir);
    await loadReadingsFolder(first.app, readingsDir);
    const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
    const readingPath = path.join(currentMassDir, "Gospel.txt");
    const massJsonPath = path.join(currentMassDir, "mass.json");
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const editedBytes = "John 1:1-5\n\nText edited outside the app.\n";
    fs.writeFileSync(readingPath, editedBytes, "utf8");
    const newerTime = new Date(fs.statSync(massJsonPath).mtimeMs + 2000);
    fs.utimesSync(readingPath, newerTime, newerTime);

    const restarted = await boot();
    try {
      const after = (await request(restarted.app).get("/api/state").expect(200)).body;
      const reading = after.readingsSource.documents.find((entry) => entry.stem === "Gospel");
      expect(fs.readFileSync(readingPath, "utf8")).toBe(editedBytes);
      expect(reading.textLines).toContain("Text edited outside the app.");
    } finally {
      await restarted.stop();
    }
  });

  test("keeps a reading file edit when a Mass save runs", async () => {
    const first = await boot();
    try {
      const readingsDir = makeReadingsFolder(homeDir);
      await loadReadingsFolder(first.app, readingsDir);
      const currentMassDir = path.join(homeDir, ".sacra-lux", "current_mass");
      const readingPath = path.join(currentMassDir, "Gospel.txt");
      const massJsonPath = path.join(currentMassDir, "mass.json");
      const editedBytes = "John 1:1-5\n\nText edited while the app was running.\n";
      fs.writeFileSync(readingPath, editedBytes, "utf8");
      const newerTime = new Date(fs.statSync(massJsonPath).mtimeMs + 2000);
      fs.utimesSync(readingPath, newerTime, newerTime);

      await request(first.app)
        .post("/api/update-title")
        .send({ title: "Saved after an external edit" })
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(fs.readFileSync(readingPath, "utf8")).toBe(editedBytes);
      const after = (await request(first.app).get("/api/state").expect(200)).body;
      const reading = after.readingsSource.documents.find((entry) => entry.stem === "Gospel");
      expect(reading.textLines).toContain("Text edited while the app was running.");
    } finally {
      await first.stop();
    }
  });

  test("keeps New Mass reading endings after a restart", async () => {
    const first = await boot();
    await request(first.app)
      .post("/api/new-mass")
      .send({ title: "Stable endings" })
      .expect(200);
    await request(first.app)
      .post("/api/save-reading")
      .send({ stem: "mass-reading-1", text: "The reading text." })
      .expect(200);

    const before = (await request(first.app).get("/api/state").expect(200)).body;
    expect(before.presentation.slides).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reading-mass-reading-1-ending", ending: "The Word of the Lord." })
    ]));
    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const restarted = await boot();
    try {
      const after = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(after.presentation.slides.map((slide) => slide.id)).toEqual(
        before.presentation.slides.map((slide) => slide.id)
      );
    } finally {
      await restarted.stop();
    }
  });

  test("moves a passage past leading blank lines when saving a reading", async () => {
    const first = await boot();
    try {
      const readingsDir = makeReadingsFolder(homeDir);
      fs.writeFileSync(path.join(readingsDir, "Gospel.txt"), "\nJohn 1:1-5\n\nOld text.", "utf8");
      await loadReadingsFolder(first.app, readingsDir);
      const { state } = require("../../src/state");
      const readingPath = path.join(state.readingsSource.folderPath, "Gospel.txt");

      const before = (await request(first.app).get("/api/state").expect(200)).body;
      const beforeDoc = before.readingsSource.documents.find((entry) => entry.stem === "Gospel");
      expect(beforeDoc.passage).toBe("John 1:1-5");
      expect(beforeDoc.textLines).toEqual(["Old text."]);

      await request(first.app)
        .post("/api/save-reading")
        .send({ stem: "Gospel", text: "New text." })
        .expect(200);

      expect(fs.readFileSync(readingPath, "utf8")).toBe("John 1:1-5\n\nNew text.");
    } finally {
      await first.stop();
    }
  });

  test("saves a passage and restores it after a server restart", async () => {
    const first = await boot();
    const readingsDir = makeReadingsFolder(homeDir);
    await loadReadingsFolder(first.app, readingsDir);

    await request(first.app)
      .post("/api/save-reading")
      .send({ stem: "Reading_I", text: "New text.", passage: "  Isaiah 55:1-11  " })
      .expect(200);

    const readingPath = path.join(homeDir, ".sacra-lux", "current_mass", "Reading_I.txt");
    expect(fs.readFileSync(readingPath, "utf8").split(/\r?\n/)[0]).toBe("Isaiah 55:1-11");
    const before = (await request(first.app).get("/api/state").expect(200)).body;
    expect(before.presentation.slides.filter((slide) => slide.id.startsWith("reading-Reading_I-")).every(
      (slide) => slide.passage === "Isaiah 55:1-11"
    )).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 700));
    await first.stop();

    const restarted = await boot();
    try {
      const after = (await request(restarted.app).get("/api/state").expect(200)).body;
      expect(after.presentation.slides.filter((slide) => slide.id.startsWith("reading-Reading_I-")).every(
        (slide) => slide.passage === "Isaiah 55:1-11"
      )).toBe(true);
    } finally {
      await restarted.stop();
    }
  });

  test.each([
    ["a number", 5, "Reading passage must be text."],
    ["empty", "", "Reading passage must be one line of 1 to 200 characters."],
    ["multiline", "Isaiah\n55:1-11", "Reading passage must be one line of 1 to 200 characters."],
    ["too long", "a".repeat(201), "Reading passage must be one line of 1 to 200 characters."]
  ])("rejects an invalid passage: %s and keeps the file", async (_label, passage, error) => {
    const first = await boot();
    try {
      const readingsDir = makeReadingsFolder(homeDir);
      await loadReadingsFolder(first.app, readingsDir);
      const readingPath = path.join(homeDir, ".sacra-lux", "current_mass", "Reading_I.txt");
      const before = fs.readFileSync(readingPath, "utf8");

      const response = await request(first.app)
        .post("/api/save-reading")
        .send({ stem: "Reading_I", text: "New text.", passage });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe(error);
      expect(fs.readFileSync(readingPath, "utf8")).toBe(before);
    } finally {
      await first.stop();
    }
  });

  test("keeps the existing passage when passage is not provided", async () => {
    const first = await boot();
    try {
      const readingsDir = makeReadingsFolder(homeDir);
      await loadReadingsFolder(first.app, readingsDir);
      const readingPath = path.join(homeDir, ".sacra-lux", "current_mass", "Reading_I.txt");
      const before = fs.readFileSync(readingPath, "utf8").split(/\r?\n/)[0];

      await request(first.app)
        .post("/api/save-reading")
        .send({ stem: "Reading_I", text: "New text." })
        .expect(200);

      expect(fs.readFileSync(readingPath, "utf8").split(/\r?\n/)[0]).toBe(before);
    } finally {
      await first.stop();
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
