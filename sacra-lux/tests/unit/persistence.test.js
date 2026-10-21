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
      massStartTime: "2026-04-12T10:30:00-04:00",
      startPinHash: { hash: "abc", salt: "def", iterations: 10 },
      targetScreenId: 9,
      targetScreenIds: [2, 2, "3", "bad", 4],
      screenFullscreen: 1,
      activeMassArchiveId: "Palm-Sunday",
      appSettings: { theme: "dark" }
    });

    const saved = JSON.parse(fs.readFileSync(getSessionFilePath(), "utf8"));

    expect(saved).toMatchObject({
      version: 2,
      lastReadingsFolderPath: "/tmp/readings",
      presentationTitle: "Palm Sunday",
      massStartTime: "2026-04-12T10:30:00-04:00",
      targetScreenId: 2,
      targetScreenIds: [2, 3, 4],
      screenFullscreen: true,
      activeMassArchiveId: "Palm-Sunday",
      appSettings: { theme: "dark" }
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
