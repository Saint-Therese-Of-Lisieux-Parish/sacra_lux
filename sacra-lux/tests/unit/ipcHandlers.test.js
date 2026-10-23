const {
  IPC_CHANNELS,
  createIpcHandlers,
  registerIpcHandlers
} = require("../../src/ipcHandlers");

function createTestHandlers(overrides = {}) {
  const state = {
    targetScreenId: null,
    targetScreenIds: []
  };

  const dependencies = {
    state,
    dialog: {
      showOpenDialog: jest.fn(async () => ({
        canceled: false,
        filePaths: ["/tmp/readings"]
      }))
    },
    screen: {
      getAllDisplays: jest.fn(() => [
        { id: 2, bounds: { width: 1920, height: 1080, x: 0, y: 0 } },
        { id: 1, bounds: { width: 1280, height: 720, x: 1920, y: 0 } }
      ]),
      getPrimaryDisplay: jest.fn(() => ({ id: 1 }))
    },
    shell: {
      openPath: jest.fn(async () => "")
    },
    fs: {
      readFileSync: jest.fn(() => Buffer.from("file-data")),
      statSync: jest.fn(() => ({ size: 1024 })),
      promises: {
        mkdir: jest.fn(async () => undefined)
      }
    },
    os: {
      homedir: jest.fn(() => "/tmp/sacra-lux-home")
    },
    saveSession: jest.fn(),
    syncTargetScreenState: jest.fn((screenIds) => {
      const normalized = [...new Set(screenIds.map(Number))];
      state.targetScreenIds = normalized;
      state.targetScreenId = normalized[0] ?? null;
    }),
    ensureConfiguredScreenWindows: jest.fn(() => []),
    setScreenFullscreen: jest.fn(() => ({ ok: true })),
    exportPdf: jest.fn(async () => ({ ok: true, path: "/tmp/mass.pdf", slideCount: 1 })),
    exportSlidePdf: jest.fn(async () => ({ ok: true, path: "/tmp/slide.pdf", slideCount: 1 })),
    getOwnerWindow: jest.fn(() => null),
    ...overrides
  };

  return {
    state,
    dependencies,
    handlers: createIpcHandlers(dependencies)
  };
}

describe("ipcHandlers", () => {
  test("loads without Electron and registers every approved channel", async () => {
    const { dependencies, handlers } = createTestHandlers();
    const registered = new Map();
    const ipcMain = {
      handle: jest.fn((channel, handler) => registered.set(channel, handler))
    };

    registerIpcHandlers({ ipcMain, handlers });

    expect([...registered.keys()]).toEqual(IPC_CHANNELS);
    const targetResult = await registered.get("screen:setTargetMonitor")({}, 3);
    expect(targetResult).toMatchObject({
      ok: true,
      targetScreenId: 3
    });
    expect(dependencies.saveSession).toHaveBeenCalledTimes(1);
  });

  test("returns the selected folder", async () => {
    const { handlers } = createTestHandlers();

    await expect(handlers["dialog:pickFolder"]()).resolves.toBe("/tmp/readings");
  });

  test("returns the selected image as an upload payload", async () => {
    const { dependencies, handlers } = createTestHandlers({
      dialog: {
        showOpenDialog: jest.fn(async () => ({
          canceled: false,
          filePaths: ["/tmp/pictures/sunday.PNG"]
        }))
      }
    });

    const result = await handlers["dialog:pickImageFile"]();

    expect(result.name).toBe("sunday.PNG");
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dependencies.fs.readFileSync).toHaveBeenCalledWith("/tmp/pictures/sunday.PNG");
  });

  test("returns the selected video as an upload payload", async () => {
    const { dependencies, handlers } = createTestHandlers({
      dialog: {
        showOpenDialog: jest.fn(async () => ({
          canceled: false,
          filePaths: ["/tmp/movies/intro.mp4"]
        }))
      }
    });

    const result = await handlers["dialog:pickVideoFile"]();

    expect(result.name).toBe("intro.mp4");
    expect(result.dataUrl).toMatch(/^data:video\/mp4;base64,/);
    expect(dependencies.fs.statSync).toHaveBeenCalledWith("/tmp/movies/intro.mp4");
  });

  test("returns null when the user cancels a picker", async () => {
    const { handlers } = createTestHandlers({
      dialog: {
        showOpenDialog: jest.fn(async () => ({
          canceled: true,
          filePaths: []
        }))
      }
    });

    await expect(handlers["dialog:pickFolder"]()).resolves.toBeNull();
    await expect(handlers["dialog:pickImageFile"]()).resolves.toBeNull();
    await expect(handlers["dialog:pickVideoFile"]()).resolves.toBeNull();
  });

  test("rejects unsupported image and oversized video files", async () => {
    const { dependencies, handlers } = createTestHandlers({
      dialog: {
        showOpenDialog: jest.fn(async () => ({
          canceled: false,
          filePaths: ["/tmp/pictures/photo.txt"]
        }))
      }
    });

    await expect(handlers["dialog:pickImageFile"]()).resolves.toMatchObject({
      error: expect.stringContaining("supported image")
    });
    expect(dependencies.fs.readFileSync).not.toHaveBeenCalled();

    const videoHandlers = createTestHandlers({
      dialog: {
        showOpenDialog: jest.fn(async () => ({
          canceled: false,
          filePaths: ["/tmp/movies/large.mp4"]
        }))
      },
      fs: {
        readFileSync: jest.fn(),
        statSync: jest.fn(() => ({ size: (500 * 1024 * 1024) + 1 })),
        promises: { mkdir: jest.fn() }
      }
    });

    await expect(videoHandlers.handlers["dialog:pickVideoFile"]()).resolves.toMatchObject({
      error: expect.stringContaining("500 MB limit")
    });
    expect(videoHandlers.dependencies.fs.readFileSync).not.toHaveBeenCalled();
  });

  test("returns the available monitors", () => {
    const { handlers } = createTestHandlers();

    const monitors = handlers["screen:getMonitors"]();

    expect(monitors).toEqual([
      expect.objectContaining({ id: 2, isPrimary: false, bounds: { width: 1920, height: 1080, x: 0, y: 0 } }),
      expect.objectContaining({ id: 1, isPrimary: true, bounds: { width: 1280, height: 720, x: 1920, y: 0 } })
    ]);
  });

  test("sets one target monitor and clears it with null", () => {
    const { handlers, state } = createTestHandlers();

    expect(handlers["screen:setTargetMonitor"](3)).toMatchObject({
      ok: true,
      targetScreenId: 3,
      targetScreenIds: [3]
    });
    expect(handlers["screen:setTargetMonitor"](null)).toMatchObject({
      ok: true,
      targetScreenId: null,
      targetScreenIds: []
    });
    expect(state.targetScreenIds).toEqual([]);
  });

  test("sets the full target monitor list", () => {
    const { handlers } = createTestHandlers();

    expect(handlers["screen:setTargetMonitors"]([3, 4])).toMatchObject({
      ok: true,
      targetScreenId: 3,
      targetScreenIds: [3, 4]
    });
  });

  test("opens the current Mass folder", async () => {
    const { dependencies, handlers } = createTestHandlers();

    await expect(handlers["folder:openMassFolder"]()).resolves.toBe("");
    expect(dependencies.fs.promises.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(".sacra-lux/current_mass"),
      { recursive: true }
    );
    expect(dependencies.shell.openPath).toHaveBeenCalledWith(
      expect.stringContaining(".sacra-lux/current_mass")
    );
  });

  test("exports the current Mass and a slide set", async () => {
    const { dependencies, handlers } = createTestHandlers();

    await expect(handlers["export:pdf"](["mass"], "high")).resolves.toMatchObject({
      ok: true,
      path: "/tmp/mass.pdf"
    });
    await expect(handlers["export:slide-pdf"](
      [{ title: "Slide" }],
      { fontFamily: "Lora" },
      "Sunday Slide",
      "medium"
    )).resolves.toMatchObject({ ok: true, path: "/tmp/slide.pdf" });

    expect(dependencies.exportPdf).toHaveBeenCalledWith(["mass"], "high");
    expect(dependencies.exportSlidePdf).toHaveBeenCalledWith(
      [{ title: "Slide" }],
      { fontFamily: "Lora" },
      "Sunday Slide",
      "medium"
    );
  });

  test("changes screen fullscreen", () => {
    const { dependencies, handlers } = createTestHandlers();

    expect(handlers["screen:fullscreen"](true)).toEqual({ ok: true });
    expect(dependencies.setScreenFullscreen).toHaveBeenCalledWith(true);
  });

  test.each([
    ["dialog:pickFolder", ["unexpected"]],
    ["dialog:pickImageFile", ["unexpected"]],
    ["dialog:pickVideoFile", ["unexpected"]],
    ["screen:getMonitors", ["unexpected"]],
    ["screen:setTargetMonitor", ["primary"]],
    ["screen:setTargetMonitors", ["1,2"]],
    ["screen:fullscreen", ["true"]],
    ["folder:openMassFolder", ["unexpected"]],
    ["export:pdf", ["mass", "high"]],
    ["export:slide-pdf", [[], {}, "Slide", "high"]]
  ])("rejects invalid input for %s", async (channel, args) => {
    const { dependencies, handlers } = createTestHandlers();

    const result = await handlers[channel](...args);

    expect(result).toMatchObject({ error: expect.any(String) });
    expect(dependencies.saveSession).not.toHaveBeenCalled();
    expect(dependencies.exportPdf).not.toHaveBeenCalled();
    expect(dependencies.exportSlidePdf).not.toHaveBeenCalled();
    expect(dependencies.setScreenFullscreen).not.toHaveBeenCalled();
  });

  test("rejects an invalid PDF quality and slide payload", async () => {
    const { handlers } = createTestHandlers();

    await expect(handlers["export:pdf"](["mass"], "ultra")).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("quality")
    });
    await expect(handlers["export:slide-pdf"](
      [{ title: "Slide" }],
      null,
      "Sunday Slide",
      "medium"
    )).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("screen settings")
    });
  });
});
