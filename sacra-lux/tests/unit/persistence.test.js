const fs = require("fs");
const path = require("path");

const { createTempHome } = require("../helpers/testHarness");

describe("persistence", () => {
  let homeDir;

  beforeEach(() => {
    jest.resetModules();
    homeDir = createTempHome("sacra-lux-persistence-");
    process.env.HOME = homeDir;
  });

  test("saveSession persists durable state with normalized target screens", () => {
    const { saveSession, getSessionFilePath } = require("../../src/persistence");

    saveSession({
      screenSettings: { fontFamily: "Merriweather" },
      organizerSequence: [{ id: "intro" }],
      manualSlides: { intro: { text: "Welcome" } },
      readingsSource: { folderPath: "/tmp/readings" },
      presentation: { title: "Palm Sunday" },
      currentSlideId: "gospel",
      currentSlideChangedAt: "2026-04-12T10:31:00-04:00",
      massStartTime: "2026-04-12T10:30:00-04:00",
      startPinHash: { hash: "abc", salt: "def", iterations: 10 },
      targetScreenId: 9,
      targetScreenIds: [2, 2, "3", "bad", 4],
      screenFullscreen: 1,
      activeMassArchiveId: "Palm-Sunday",
      appSettings: { theme: "dark", remoteAddress: "10.12.1.1", sourceNetworks: "192.168.1.0/24" }
    });

    const saved = JSON.parse(fs.readFileSync(getSessionFilePath(), "utf8"));

    expect(saved).toMatchObject({
      version: 2,
      lastReadingsFolderPath: "/tmp/readings",
      presentationTitle: "Palm Sunday",
      currentSlideId: "gospel",
      currentSlideChangedAt: "2026-04-12T10:31:00-04:00",
      massStartTime: "2026-04-12T10:30:00-04:00",
      targetScreenId: 2,
      targetScreenIds: [2, 3, 4],
      screenFullscreen: true,
      activeMassArchiveId: "Palm-Sunday",
      appSettings: { theme: "dark", remoteAddress: "10.12.1.1", sourceNetworks: "192.168.1.0/24" }
    });
  });

  test("loadSession migrates v1 fields into the current format", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.writeFileSync(getSessionFilePath(), JSON.stringify({
      manualCues: { intro: { text: "Hello" } },
      displaySettings: {
        wordBackgroundUrl: "/dark.jpg",
        graphicBackgroundUrl: "/light.jpg"
      },
      organizerSequence: [
        {
          id: "legacy",
          type: "graphic",
          phase: "warmup",
          backgroundType: "word"
        }
      ],
      targetDisplayId: 7,
      displayFullscreen: true
    }), "utf8");

    const session = loadSession();

    expect(session.version).toBe(2);
    expect(session.manualSlides).toEqual({ intro: { text: "Hello" } });
    expect(session.screenSettings).toMatchObject({
      darkBackgroundUrl: "/dark.jpg",
      lightBackgroundUrl: "/light.jpg"
    });
    expect(session.organizerSequence).toEqual([
      {
        id: "legacy",
        type: "image",
        phase: "gathering",
        backgroundTheme: "dark"
      }
    ]);
    expect(session.targetScreenId).toBe(7);
    expect(session.screenFullscreen).toBe(true);
  });

  test("loadSession returns null for malformed session data", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.writeFileSync(getSessionFilePath(), "{not-json", "utf8");

    expect(loadSession()).toBeNull();
  });

  test("saveSession leaves no temporary file behind", () => {
    const { saveSession, getSessionFilePath } = require("../../src/persistence");

    saveSession(sessionState("Atomic Save"));

    const dir = path.dirname(getSessionFilePath());
    expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  test("loadSession reports damage and recovers the session from the backup", () => {
    const { saveSession, loadSession, getSessionFilePath } = require("../../src/persistence");

    saveSession(sessionState("Prior Session"));
    saveSession(sessionState("Current Session"));
    fs.writeFileSync(getSessionFilePath(), "{not-json", "utf8");

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });
    const session = loadSession();

    expect(session.presentationTitle).toBe("Prior Session");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/damaged/i));
    warnSpy.mockRestore();
  });

  test("migrates legacy color and image background fields", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.writeFileSync(getSessionFilePath(), JSON.stringify({
      displaySettings: {
        colorBackgroundUrl: "/dark.jpg",
        imageBackgroundUrl: "/light.jpg"
      }
    }), "utf8");

    expect(loadSession().screenSettings).toEqual({
      darkBackgroundUrl: "/dark.jpg",
      lightBackgroundUrl: "/light.jpg"
    });
  });

  test("migrates legacy organizer background values", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.writeFileSync(getSessionFilePath(), JSON.stringify({
      organizerSequence: [
        { id: "word", backgroundType: "word" },
        { id: "color", backgroundType: "color" },
        { id: "graphic", backgroundType: "graphic" },
        { id: "image", backgroundType: "image" },
        { id: "custom", backgroundType: "custom" }
      ]
    }), "utf8");

    expect(loadSession().organizerSequence.map((item) => item.backgroundTheme)).toEqual([
      "dark", "dark", "light", "light", "custom"
    ]);
  });

  test("returns null when the primary and backup sessions are damaged", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.writeFileSync(getSessionFilePath(), "null", "utf8");
    fs.writeFileSync(`${getSessionFilePath()}.bak`, "null", "utf8");

    expect(loadSession()).toBeNull();
  });

  test("logs a save error without throwing", () => {
    jest.resetModules();
    jest.doMock("../../src/atomicWrite", () => ({
      writeFileAtomic: () => {
        throw new Error("disk full");
      }
    }));
    const logger = require("../../src/logger");
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
    const { saveSession } = require("../../src/persistence");

    expect(() => saveSession(sessionState("Save Error"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    errorSpy.mockRestore();
    jest.dontMock("../../src/atomicWrite");
  });
});

function sessionState(title) {
  return {
    screenSettings: {},
    organizerSequence: [],
    manualSlides: {},
    readingsSource: {},
    presentation: { title },
    massStartTime: null,
    startPinHash: null,
    targetScreenId: null,
    targetScreenIds: [],
    screenFullscreen: false,
    activeMassArchiveId: null,
    appSettings: { theme: "dark" }
  };
}

describe("persistence fixtures", () => {
  const sessionFixture = path.join(__dirname, "..", "fixtures", "session-v2.json");

  beforeEach(() => {
    jest.resetModules();
    process.env.HOME = createTempHome("sacra-lux-persistence-fixture-");
  });

  test("loadSession reads a frozen session.json v2 file without changes", () => {
    const { getSessionFilePath, loadSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.copyFileSync(sessionFixture, getSessionFilePath());

    expect(loadSession()).toEqual(JSON.parse(fs.readFileSync(sessionFixture, "utf8")));
  });

  test("a frozen session.json v2 file survives a save and load round trip", () => {
    const { getSessionFilePath, loadSession, saveSession } = require("../../src/persistence");
    fs.mkdirSync(path.dirname(getSessionFilePath()), { recursive: true });
    fs.copyFileSync(sessionFixture, getSessionFilePath());

    const loaded = loadSession();
    saveSession({
      ...loaded,
      readingsSource: { folderPath: loaded.lastReadingsFolderPath },
      presentation: { title: loaded.presentationTitle }
    });

    const { savedAt: loadedSavedAt, ...loadedRest } = loaded;
    const { savedAt: reloadedSavedAt, ...reloadedRest } = loadSession();
    expect(loadedSavedAt).toBeDefined();
    expect(reloadedSavedAt).toBeDefined();
    expect(reloadedRest).toEqual(loadedRest);
  });
});
