const fs = require("fs");
const path = require("path");

const MAIN_PATH = path.join(__dirname, "../../src/main.js");
const PRELOAD_PATH = path.join(__dirname, "../../src/preload.js");
const AGENTS_PATH = path.join(__dirname, "../../../AGENTS.md");

// Load src/main.js with a mocked electron module and run app start up.
async function startMain() {
  jest.resetModules();
  const windows = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      this.webContents = {
        on: jest.fn((name, handler) => {
          this.listeners[name] = handler;
        }),
        setWindowOpenHandler: jest.fn((handler) => {
          this.openHandler = handler;
        }),
        setFrameRate: jest.fn(),
        executeJavaScript: jest.fn()
      };
      windows.push(this);
    }
    on() {}
    loadURL() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    isVisible() { return false; }
    show() {}
    focus() {}
    close() {}
    destroy() {}
    setBounds() {}
    setFullScreen() {}
  }
  FakeBrowserWindow.getAllWindows = () => windows;

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const electron = {
    app: {
      commandLine: { appendSwitch: jest.fn() },
      whenReady: () => ready,
      on: jest.fn(),
      quit: jest.fn(),
      getPath: jest.fn(() => "/tmp")
    },
    BrowserWindow: FakeBrowserWindow,
    Menu: { buildFromTemplate: jest.fn(() => ({})), setApplicationMenu: jest.fn() },
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    dialog: { showErrorBox: jest.fn() },
    screen: { getAllDisplays: jest.fn(() => []), getPrimaryDisplay: jest.fn(() => ({ id: 1 })) },
    shell: {}
  };
  const server = {
    once: jest.fn((name, handler) => {
      if (name === "listening") setImmediate(handler);
    }),
    removeListener: jest.fn(),
    address: () => ({ port: 17841 }),
    listen: jest.fn()
  };

  jest.doMock("electron", () => electron, { virtual: true });
  jest.doMock("../../src/server", () => ({
    startServer: jest.fn(() => ({ io: { on: jest.fn(), emit: jest.fn() }, server })),
    saveCurrentMass: jest.fn()
  }));
  jest.doMock("../../src/persistence", () => ({ saveSession: jest.fn() }));
  jest.doMock("../../src/cliBanner", () => ({ writeStartupBanner: jest.fn() }));
  jest.doMock("../../src/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    isQuietLogs: jest.fn(() => true)
  }));

  require("../../src/main");
  resolveReady();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return windows;
}

describe("Electron window security settings", () => {
  test("every window sets contextIsolation and never sets nodeIntegration", async () => {
    const windows = await startMain();

    // The app, screen, and splash windows. The remote and capture windows open later.
    expect(windows).toHaveLength(3);
    for (const win of windows) {
      expect(win.options.webPreferences.contextIsolation).toBe(true);
      expect(win.options.webPreferences.nodeIntegration).not.toBe(true);
    }
  });

  test("main.js creates only windows with contextIsolation set to true", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const constructors = source.match(/new BrowserWindow\(\{[\s\S]*?\n {0,2}\}\);/g) || [];

    expect(constructors).toHaveLength(5);
    for (const block of constructors) {
      expect(block).toMatch(/contextIsolation: true/);
      expect(block).not.toMatch(/nodeIntegration: true/);
      expect(block).not.toMatch(/contextIsolation: false/);
    }
  });

  // Sandbox stays off because the app and screen windows load local pages with the
  // preload bridge, and the offscreen capture window renders local slides only. All of
  // them are limited by contextIsolation and the navigation lock. The splash window has
  // no preload and uses the default sandbox setting.
  test("records the sandbox setting of each window", async () => {
    const windows = await startMain();
    const byTitle = Object.fromEntries(windows.map((win) => [win.options.title || "splash", win]));

    expect(byTitle["Sacra Lux"].options.webPreferences.sandbox).toBe(false);
    expect(byTitle["Sacra Lux Screen"].options.webPreferences.sandbox).toBe(false);
    expect(byTitle.splash.options.webPreferences.sandbox).toBeUndefined();
  });

  test("the app window denies external windows and opens only the remote popup", async () => {
    const windows = await startMain();
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");

    expect(appWindow.openHandler({ url: "https://evil.example/" })).toEqual({ action: "deny" });
    expect(appWindow.openHandler({ url: "http://localhost:17841/remote" })).toEqual({ action: "deny" });

    const remote = windows.find((win) => win.options.title === "Sacra Lux — Remote");
    expect(remote.options.webPreferences.contextIsolation).toBe(true);
    expect(remote.options.webPreferences.nodeIntegration).not.toBe(true);
    expect(remote.openHandler({ url: "https://evil.example/" })).toEqual({ action: "deny" });
  });

  test("every window cancels navigation to an external URL", async () => {
    const windows = await startMain();

    for (const win of windows) {
      const external = { preventDefault: jest.fn() };
      win.listeners["will-navigate"](external, "https://evil.example/");
      expect(external.preventDefault).toHaveBeenCalledTimes(1);

      const local = { preventDefault: jest.fn() };
      win.listeners["will-navigate"](local, "http://localhost:17841/screen");
      expect(local.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("Electron preload bridge", () => {
  test("exposes only the names in the AGENTS.md list", () => {
    const agents = fs.readFileSync(AGENTS_PATH, "utf8");
    const section = agents.split("The approved `window.api` surface is:")[1].split("\n## ")[0];
    const documented = [...section.matchAll(/^- `(\w+)(?:\(\))?`$/gm)].map((match) => match[1]);

    const exposeInMainWorld = jest.fn();
    jest.resetModules();
    jest.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke: jest.fn() }
    }), { virtual: true });
    require(PRELOAD_PATH);

    const exposed = Object.keys(exposeInMainWorld.mock.calls[0][1]);
    expect(documented.length).toBeGreaterThan(0);
    expect(exposed.sort()).toEqual(documented.sort());
  });
});
