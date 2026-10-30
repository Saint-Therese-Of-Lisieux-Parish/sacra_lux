const fs = require("fs");
const { EventEmitter } = require("events");
const path = require("path");

const MAIN_PATH = path.join(__dirname, "../../src/main.js");
const PRELOAD_PATH = path.join(__dirname, "../../src/preload.js");
const AGENTS_PATH = path.join(__dirname, "../../../AGENTS.md");

// Load src/main.js with a mocked electron module and run app start up.
async function startMain({
  singleInstanceLock = true,
  portInUse = false,
  platform = process.platform,
  displays = []
} = {}) {
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
      this.setFullScreen = jest.fn();
      windows.push(this);
    }
    on(name, handler) { this.listeners[name] = handler; }
    loadURL() {}
    isDestroyed() { return false; }
    isMinimized() { return false; }
    isVisible() { return false; }
    show() {}
    focus() {}
    restore() {}
    close() {}
    destroy() {}
    setBounds() {}
  }
  FakeBrowserWindow.getAllWindows = () => windows;

  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const electron = {
    app: {
      commandLine: { appendSwitch: jest.fn() },
      requestSingleInstanceLock: jest.fn(() => singleInstanceLock),
      whenReady: () => ready,
      on: jest.fn(),
      quit: jest.fn(),
      getPath: jest.fn(() => "/tmp")
    },
    BrowserWindow: FakeBrowserWindow,
    Menu: {
      buildFromTemplate: jest.fn((template) => ({
        getMenuItemById: (id) => template
          .flatMap((item) => item.submenu?.items || item.submenu || [item])
          .find((item) => item.id === id)
      })),
      setApplicationMenu: jest.fn()
    },
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    dialog: { showErrorBox: jest.fn(), showMessageBoxSync: jest.fn(() => 1) },
    screen: {
      getAllDisplays: jest.fn(() => displays),
      getPrimaryDisplay: jest.fn(() => displays[0] || { id: 1 }),
      getDisplayNearestPoint: jest.fn(() => displays[0] || { id: 1 })
    },
    shell: { openExternal: jest.fn() }
  };
  electron.powerMonitor = new EventEmitter();
  electron.powerSaveBlocker = {
    start: jest.fn(() => 17),
    isStarted: jest.fn(() => true),
    stop: jest.fn()
  };
  const server = {
    once: jest.fn((name, handler) => {
      if (name === "listening" && !portInUse) setImmediate(handler);
      if (name === "error" && portInUse) setImmediate(() => handler({ code: "EADDRINUSE" }));
    }),
    removeListener: jest.fn(),
    address: () => ({ port: 17841 }),
    listen: jest.fn()
  };

  jest.doMock("electron", () => electron, { virtual: true });
  const saveCurrentMass = jest.fn();
  const flushPendingSave = jest.fn();
  const resetStartPin = jest.fn();
  const rescheduleStartTimer = jest.fn();
  const io = { on: jest.fn(), emit: jest.fn() };
  const startServer = jest.fn(() => ({ io, server, rescheduleStartTimer }));
  jest.doMock("../../src/server", () => ({
    startServer,
    saveCurrentMass,
    flushPendingSave,
    resetStartPin
  }));
  jest.doMock("../../src/persistence", () => ({ saveSession: jest.fn() }));
  jest.doMock("../../src/cliBanner", () => ({ writeStartupBanner: jest.fn() }));
  jest.doMock("../../src/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    isQuietLogs: jest.fn(() => true)
  }));

  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  require("../../src/main");
  resolveReady();
  await new Promise((resolve) => setTimeout(resolve, 50));
  Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  windows.electron = electron;
  windows.io = io;
  windows.startServer = startServer;
  windows.saveCurrentMass = saveCurrentMass;
  windows.flushPendingSave = flushPendingSave;
  windows.resetStartPin = resetStartPin;
  windows.rescheduleStartTimer = rescheduleStartTimer;
  return windows;
}

describe("Electron window security settings", () => {
  test("does not auto-fullscreen when the operator turned fullscreen off", async () => {
    const windows = await startMain({ displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }] });
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const toggle = template.find((item) => item.label === "Window" || item.role === "windowMenu").submenu.find((item) => item.id === "toggle-screen-fullscreen");
    toggle.click();
    toggle.click();
    for (const win of windows.filter((item) => item.options.title === "Sacra Lux Screen")) {
      win.setFullScreen.mockClear();
    }
    const state = require("../../src/state").state;
    state.targetScreenIds = [2];
    windows.io.emit("state:update", { preMassRunning: true });
    expect(windows.filter((win) => win.options.title === "Sacra Lux Screen").every((win) => !win.setFullScreen.mock.calls.length)).toBe(true);
  });

  test("does not auto-fullscreen screen windows on the primary display", async () => {
    const windows = await startMain({ displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] });
    windows.io.emit("state:update", { preMassRunning: true });
    expect(windows.filter((win) => win.options.title === "Sacra Lux Screen").every((win) => !win.setFullScreen.mock.calls.length)).toBe(true);
  });

  test("auto-fullscreens a separate target display and updates the menu", async () => {
    const windows = await startMain({ displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }] });
    const state = require("../../src/state").state;
    state.targetScreenIds = [2];
    windows.io.emit("state:update", { preMassRunning: true });
    const screenWindows = windows.filter((win) => win.options.title === "Sacra Lux Screen");
    expect(screenWindows.at(-1).setFullScreen).toHaveBeenCalledWith(true);
    expect(state.screenFullscreen).toBe(true);
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const toggle = template.find((item) => item.label === "Window" || item.role === "windowMenu").submenu.find((item) => item.id === "toggle-screen-fullscreen");
    expect(toggle.label).toBe("Exit Screen Fullscreen");
  });

  test("a second app instance quits before it starts the server", async () => {
    const windows = await startMain({ singleInstanceLock: false });

    expect(windows).toHaveLength(0);
    expect(windows.electron.app.quit).toHaveBeenCalledTimes(1);
    expect(windows.startServer).not.toHaveBeenCalled();
  });

  test("a second instance shows and focuses the first app window", async () => {
    const windows = await startMain();
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");
    appWindow.show = jest.fn();
    appWindow.focus = jest.fn();
    const secondInstance = windows.electron.app.on.mock.calls.find(([name]) => name === "second-instance");

    secondInstance[1]();

    expect(appWindow.show).toHaveBeenCalledTimes(1);
    expect(appWindow.focus).toHaveBeenCalledTimes(1);
  });

  test("Show App Window creates the app window again after it closes", async () => {
    const windows = await startMain();
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");
    appWindow.listeners.closed();
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const windowMenu = template.find((item) => item.label === "Window" || item.role === "windowMenu");
    windowMenu.submenu.find((item) => item.label === "Show App Window").click();

    expect(windows.filter((win) => win.options.title === "Sacra Lux")).toHaveLength(2);
  });

  test("activation shows recreated app and screen windows", async () => {
    const windows = await startMain({
      displays: [
        { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
      ]
    });
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");
    const screenWindows = windows.filter((win) => win.options.title === "Sacra Lux Screen");
    const activate = windows.electron.app.on.mock.calls.find(([name]) => name === "activate");

    appWindow.listeners.closed();
    screenWindows.forEach((win) => win.listeners.closed());
    windows.electron.BrowserWindow.getAllWindows = () => [];
    activate[1]();

    const recreatedApp = windows.find((win, index) => index > 2 && win.options.title === "Sacra Lux");
    const recreatedScreens = windows.filter((win, index) => index > 2 && win.options.title === "Sacra Lux Screen");
    recreatedApp.show = jest.fn();
    recreatedApp.focus = jest.fn();
    recreatedScreens.forEach((win) => {
      win.show = jest.fn();
      win.focus = jest.fn();
    });

    recreatedApp.listeners["did-finish-load"]();

    expect(recreatedApp.show).toHaveBeenCalledTimes(1);
    expect(recreatedApp.focus).toHaveBeenCalledTimes(1);
    expect(recreatedScreens.every((win) => win.show.mock.calls.length === 1)).toBe(true);
    expect(recreatedScreens.every((win) => win.focus.mock.calls.length === 1)).toBe(true);
  });

  test("Windows asks before quitting", async () => {
    const windows = await startMain({ platform: "win32" });
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");
    const closeEvent = { preventDefault: jest.fn() };
    windows.electron.dialog.showMessageBoxSync.mockReturnValue(1);
    appWindow.listeners.close(closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(windows.electron.app.quit).not.toHaveBeenCalled();

    windows.electron.dialog.showMessageBoxSync.mockReturnValue(0);
    appWindow.listeners.close({ preventDefault: jest.fn() });
    expect(windows.electron.app.quit).toHaveBeenCalledTimes(1);
  });

  test("a busy configured port shows an error and does not use another port", async () => {
    const windows = await startMain({ portInUse: true });

    expect(windows.electron.dialog.showErrorBox).toHaveBeenCalledWith(
      "Sacra Lux could not start",
      "Port 17841 is already in use."
    );
  });

  test("every window sets contextIsolation and never sets nodeIntegration", async () => {
    const windows = await startMain();

    // The app, screen, and splash windows. The remote and capture windows open later.
    expect(windows).toHaveLength(3);
    for (const win of windows) {
      expect(win.options.webPreferences.contextIsolation).toBe(true);
      expect(win.options.webPreferences.nodeIntegration).not.toBe(true);
    }
  });

  test("the start window has no transparent area and a click only closes it", async () => {
    const windows = await startMain();
    const splash = windows.find((win) => !win.options.title);

    expect(splash.options.transparent).toBeUndefined();
    expect(splash.options.backgroundColor).toBeTruthy();
    splash.listeners["did-finish-load"]();
    const script = splash.webContents.executeJavaScript.mock.calls[0][0];
    expect(script).toContain("window.close()");
    expect(script).not.toContain("location.href");
    expect(windows.electron.shell.openExternal).not.toHaveBeenCalled();
  });

  test("the Help menu has a Documentation Website item for the site", async () => {
    const windows = await startMain();
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const help = template.find((item) => item.role === "help");
    const item = help.submenu.find((entry) => entry.label === "Documentation Website");

    item.click();
    expect(windows.electron.shell.openExternal).toHaveBeenCalledWith(
      "https://saint-therese-of-lisieux-parish.github.io/sacra_lux/"
    );
  });

  test("a pending save is written when the app starts to quit", async () => {
    const windows = await startMain();
    const beforeQuit = windows.electron.app.on.mock.calls.find(([name]) => name === "before-quit");

    expect(beforeQuit).toBeDefined();
    beforeQuit[1]();

    expect(windows.flushPendingSave).toHaveBeenCalledTimes(1);
  });

  test("prevents display sleep while the screen window is open", async () => {
    const windows = await startMain();
    const screen = windows.find((win) => win.options.title === "Sacra Lux Screen");

    expect(windows.electron.powerSaveBlocker.start).toHaveBeenCalledWith("prevent-display-sleep");

    screen.listeners.closed();
    expect(windows.electron.powerSaveBlocker.isStarted).toHaveBeenCalledWith(17);
    expect(windows.electron.powerSaveBlocker.stop).toHaveBeenCalledWith(17);
  });

  test("stops preventing display sleep when the app quits", async () => {
    const windows = await startMain();
    const beforeQuit = windows.electron.app.on.mock.calls.find(([name]) => name === "before-quit");

    beforeQuit[1]();
    expect(windows.electron.powerSaveBlocker.stop).toHaveBeenCalledWith(17);
  });

  test("reschedules Mass start timers when the computer resumes", async () => {
    const windows = await startMain();

    windows.electron.powerMonitor.emit("resume");

    expect(windows.rescheduleStartTimer).toHaveBeenCalledTimes(1);
  });

  test("the Save menu item shows a success status", async () => {
    const windows = await startMain();
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const file = template.find((item) => item.label === "File");
    const save = file.submenu.find((item) => item.label === "Save");
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");

    save.click();

    expect(windows.saveCurrentMass).toHaveBeenCalledTimes(1);
    expect(appWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("desktop-status")
    );
    expect(appWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("Mass saved")
    );
  });

  test("the Reset Start PIN menu item resets the PIN after confirmation", async () => {
    const windows = await startMain();
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const file = template.find((item) => item.label === "File");
    const reset = file.submenu.find((item) => item.label === "Reset Start PIN");

    reset.click();

    expect(windows.electron.dialog.showMessageBoxSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Reset Start PIN",
        buttons: ["Cancel", "Reset Start PIN"]
      })
    );
    expect(windows.resetStartPin).toHaveBeenCalledTimes(1);
  });

  test("the Save menu item shows an error status without throwing", async () => {
    const windows = await startMain();
    windows.saveCurrentMass.mockImplementation(() => {
      throw new Error("Disk full");
    });
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const file = template.find((item) => item.label === "File");
    const save = file.submenu.find((item) => item.label === "Save");
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");

    expect(() => save.click()).not.toThrow();
    expect(appWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("Disk full")
    );
  });

  test("a click on the About window opens the site and closes the window", async () => {
    const windows = await startMain();
    const template = windows.electron.Menu.buildFromTemplate.mock.calls[0][0];
    const help = template.find((item) => item.role === "help");
    help.submenu.find((entry) => entry.label === "About Sacra Lux").click();
    const about = windows[windows.length - 1];
    about.close = jest.fn();

    about.listeners["did-finish-load"]();
    const script = about.webContents.executeJavaScript.mock.calls[0][0];
    expect(script).toContain("https://saint-therese-of-lisieux-parish.github.io/sacra_lux/");
    expect(about.options.transparent).toBeUndefined();

    about.listeners["will-navigate"]({ preventDefault: jest.fn() }, "https://saint-therese-of-lisieux-parish.github.io/sacra_lux/");
    expect(windows.electron.shell.openExternal).toHaveBeenCalledWith(
      "https://saint-therese-of-lisieux-parish.github.io/sacra_lux/"
    );
    expect(about.close).toHaveBeenCalled();
  });

  test("main.js creates only windows with contextIsolation set to true", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const constructors = source.match(/new BrowserWindow\(\{[\s\S]*?\n {0,2}\}\);/g) || [];

    expect(constructors).toHaveLength(5);
    for (const block of constructors) {
      expect(block).toMatch(/contextIsolation: true/);
      expect(block).toMatch(/sandbox: true/);
      expect(block).not.toMatch(/nodeIntegration: true/);
      expect(block).not.toMatch(/contextIsolation: false/);
    }
  });

  test("enables the sandbox for each window", async () => {
    const windows = await startMain();
    const byTitle = Object.fromEntries(windows.map((win) => [win.options.title || "splash", win]));

    expect(byTitle["Sacra Lux"].options.webPreferences.sandbox).toBe(true);
    expect(byTitle["Sacra Lux Screen"].options.webPreferences.sandbox).toBe(true);
    expect(byTitle.splash.options.webPreferences.sandbox).toBe(true);
  });

  test("the app window denies external windows and opens only the remote popup", async () => {
    const windows = await startMain();
    const appWindow = windows.find((win) => win.options.title === "Sacra Lux");

    expect(appWindow.openHandler({ url: "https://evil.example/" })).toEqual({ action: "deny" });
    expect(appWindow.openHandler({ url: "http://localhost:17841/remote" })).toEqual({ action: "deny" });

    const remote = windows.find((win) => win.options.title === "Sacra Lux — Remote");
    expect(remote.options.webPreferences.contextIsolation).toBe(true);
    expect(remote.options.webPreferences.nodeIntegration).not.toBe(true);
    expect(remote.options.webPreferences.sandbox).toBe(true);
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
