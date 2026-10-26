const { app, BrowserWindow, Menu, ipcMain, dialog, screen, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");

const { startServer, saveCurrentMass, flushPendingSave } = require("./server");
const { state } = require("./state");
const { saveSession } = require("./persistence");
const { listThemes, getTheme } = require("./themes");
const logger = require("./logger");
const { writeStartupBanner } = require("./cliBanner");
const { createIpcHandlers, registerIpcHandlers } = require("./ipcHandlers");
const { secureWindow } = require("./windowSecurity");
const { sanitizePdfFileName } = require("./pdfFileName");

const configuredPort = Number.parseInt(process.env.SACRA_LUX_PORT || "17841", 10);
const DEFAULT_PORT = Number.isInteger(configuredPort) && configuredPort > 0
  ? configuredPort
  : 17841;
let PORT = DEFAULT_PORT;
const PRELOAD_PATH = path.join(__dirname, "preload.js");

const pkg = require("../package.json");

const SITE_URL = "https://saint-therese-of-lisieux-parish.github.io/sacra_lux/";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let appWindow;
let screenWindow;
const screenWindows = new Map();
let remoteWindow;
let splashWindow;
let appMenu = null;

// Every window may navigate only inside the local app origin.
function lockWindow(win) {
  secureWindow(win, { getPort: () => PORT, getLocalAddress: getLocalIpv4Address });
}

function getLocalIpv4Address() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) {
      continue;
    }

    for (const info of addresses) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }

  return "localhost";
}

/**
 * Start the Electron-owned server, falling back to an ephemeral local port
 * when the preferred port is already used by a separately running web server.
 */
function startDesktopServer() {
  // Write the banner once. A later port retry does not write it again.
  writeStartupBanner({
    stdout: process.stdout,
    env: process.env,
    quiet: logger.isQuietLogs(),
    version: pkg.version,
    log: (message) => logger.info(message)
  });

  return new Promise((resolve, reject) => {
    const { io, server } = startServer(PORT);

    const onListening = () => {
      const address = server.address();
      if (address && typeof address === "object") {
        PORT = address.port;
      }
      resolve(io);
    };

    const onInitialError = (error) => {
      if (error?.code !== "EADDRINUSE") {
        reject(error);
        return;
      }

      server.removeListener("listening", onListening);
      logger.info(`[desktop] Port ${PORT} is already in use; selecting an available local port.`);
      server.once("listening", onListening);
      server.once("error", reject);
      server.listen(0, "0.0.0.0");
    };

    server.once("listening", onListening);
    server.once("error", onInitialError);
  });
}

function isRemotePopupUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname === "/remote";
  } catch {
    return false;
  }
}

function openOrFocusRemoteWindow(url) {
  if (remoteWindow && !remoteWindow.isDestroyed()) {
    remoteWindow.loadURL(url);
    if (remoteWindow.isMinimized()) remoteWindow.restore();
    remoteWindow.focus();
    return;
  }

  remoteWindow = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: "Sacra Lux — Remote",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  lockWindow(remoteWindow);
  remoteWindow.on("closed", () => {
    remoteWindow = null;
  });

  remoteWindow.loadURL(url);
}

function configurePopupHandling() {
  if (!appWindow || appWindow.isDestroyed()) return;

  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isRemotePopupUrl(url)) {
      openOrFocusRemoteWindow(url);
    }
    return { action: "deny" };
  });
}

function showWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function runInAppWindow(script) {
  if (!appWindow || appWindow.isDestroyed()) return;
  showWindow(appWindow);
  appWindow.webContents.executeJavaScript(script);
}

function clickAppButton(buttonId) {
  runInAppWindow(`document.getElementById(${JSON.stringify(buttonId)})?.click()`);
}

function showAppStatus(message) {
  runInAppWindow(
    `document.dispatchEvent(new CustomEvent("desktop-status", { detail: ${JSON.stringify(message)} }))`
  );
}

function normalizeTargetScreenIds(screenIds) {
  return [...new Set((Array.isArray(screenIds) ? screenIds : [])
    .map((id) => Number(id))
    .filter(Number.isFinite))];
}

function syncTargetScreenState(screenIds) {
  const normalized = normalizeTargetScreenIds(screenIds);
  state.targetScreenIds = normalized;
  state.targetScreenId = normalized[0] ?? null;
}

function getScreenWindowList() {
  return [...screenWindows.values()].filter((win) => win && !win.isDestroyed());
}

function syncPrimaryScreenWindow() {
  screenWindow = getScreenWindowList()[0] || null;
}

function createAppWindow() {
  appWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Sacra Lux",
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: PRELOAD_PATH
    }
  });
  lockWindow(appWindow);
}

function createScreenWindow(targetScreenId = null) {
  const key = targetScreenId == null ? "default" : String(targetScreenId);
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    title: "Sacra Lux Screen",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  lockWindow(win);

  if (targetScreenId != null) {
    const target = screen.getAllDisplays().find((display) => display.id === targetScreenId);
    if (target) {
      const { x, y, width, height } = target.bounds;
      win.setBounds({ x, y, width, height });
    }
  }

  screenWindows.set(key, win);
  syncPrimaryScreenWindow();

  win.on("closed", () => {
    screenWindows.delete(key);
    syncPrimaryScreenWindow();
  });

  win.loadURL(`http://localhost:${PORT}/screen`);
  return win;
}

function destroyAllScreenWindows() {
  for (const win of getScreenWindowList()) {
    win.destroy();
  }
  screenWindows.clear();
  syncPrimaryScreenWindow();
}

function ensureConfiguredScreenWindows() {
  const targetIds = normalizeTargetScreenIds(state.targetScreenIds);
  const desiredKeys = targetIds.length > 0
    ? targetIds.map((id) => String(id))
    : ["default"];
  const existingKeys = new Set([...screenWindows.keys()]);

  if (desiredKeys.length === existingKeys.size && desiredKeys.every((key) => existingKeys.has(key))) {
    syncPrimaryScreenWindow();
    return getScreenWindowList();
  }

  destroyAllScreenWindows();

  if (targetIds.length > 0) {
    for (const id of targetIds) {
      createScreenWindow(id);
    }
  } else {
    createScreenWindow(null);
  }

  if (state.screenFullscreen) {
    for (const win of getScreenWindowList()) {
      win.setFullScreen(true);
    }
  }

  return getScreenWindowList();
}

function createWindows() {
  // Create the main control-surface window.
  createAppWindow();

  appWindow.loadURL(`http://localhost:${PORT}/`);
  ensureConfiguredScreenWindows();
  configurePopupHandling();

  const remoteUrl = `http://${getLocalIpv4Address()}:${PORT}/remote`;
  logger.info(`Phone remote URL: ${remoteUrl}`);
}

function fullscreenScreen() {
  const windows = ensureConfiguredScreenWindows();
  for (const win of windows) {
    if (win.isMinimized()) win.restore();
    win.setFullScreen(true);
  }
}


// ── IPC wiring ────────────────────────────────────────────────────────────────

// ── PDF export ───────────────────────────────────────────────────────────────

// Number of offscreen capture windows to run in parallel.
const PDF_CAPTURE_CONCURRENCY = 4;
// Minimum settle time (ms) after render() before capturePage(), to allow the
// GPU compositor to flush the frame even when there are no images to wait for.
const PDF_SETTLE_FLOOR_MS = 300;
// Settle time for slides with a background image — the CSS background pipeline
// (decode → raster → GPU texture upload → composite) needs more time than text
// slides.
const PDF_IMAGE_SETTLE_MS = 600;
// Quality presets: width/height are the output dimensions (NativeImage.resize
// handles downscaling before JPEG encoding). Capturing always happens at full
// 1920×1080 so rendering is pixel-perfect regardless of output size.
const PDF_QUALITY_PRESETS = {
  high:   { width: 1920, height: 1080, jpegQuality: 92 },
  medium: { width: 1280, height: 720,  jpegQuality: 80 },
  small:  { width: 960,  height: 540,  jpegQuality: 65 },
};

/**
 * Create and initialise a single offscreen 1920×1080 capture window.
 * Waits for fonts to be ready rather than using a fixed delay.
 */
async function createCaptureWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: true }
  });
  lockWindow(win);
  win.webContents.setFrameRate(30);
  // Load in preview mode: the screen page skips the Socket.IO state:update
  // listener AND the initial fetch("/api/state").then(renderWithIdle) entirely.
  // This is the only reliable way to prevent those callbacks from firing during
  // our settle waits — overwriting renderWithIdle after load does not work
  // because .then(renderWithIdle) captures the function reference at the time
  // the line is parsed, not a live lookup of the global name.
  await win.loadURL(`http://localhost:${PORT}/screen?preview=1`);
  // document.fonts.ready resolves once all fonts are loaded — faster than a
  // fixed 2 s delay and still guarantees text is correctly rendered.
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => null)");
  await win.webContents.executeJavaScript(`
    Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true });
    if (typeof updateFrameScale === 'function') updateFrameScale();
    const overlay = document.getElementById('idleQrOverlay');
    if (overlay) overlay.style.display = 'none';
    const fsPrompt = document.getElementById('fullscreenPrompt');
    if (fsPrompt) fsPrompt.style.display = 'none';
    // Kill all CSS transitions so frame opacity and tint transitions cannot
    // bleed into a capture even if the JS render path triggers them.
    var _noTransStyle = document.createElement('style');
    _noTransStyle.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.appendChild(_noTransStyle);
    // Disconnect the Socket.IO socket that preview mode still opens so the
    // server does not accumulate idle connections during long exports.
    if (typeof socket !== 'undefined') { try { void socket.disconnect(); } catch(e) {} }
  `);
  return win;
}

async function exportCurrentMassPdf(phases, quality) {
  const preset = PDF_QUALITY_PRESETS[quality] || PDF_QUALITY_PRESETS.high;
  const { PDFDocument } = require("pdf-lib");

  // Fetch current state from the server
  const stateResp = await fetch(`http://localhost:${PORT}/api/state`);
  const currentState = await stateResp.json();
  const allSlides = currentState.presentation?.slides || [];
  // Filter by requested phases; null/undefined/empty means export all phases.
  const slides = (phases && phases.length)
    ? allSlides.filter((s) => phases.includes(s.phase))
    : allSlides;
  if (slides.length === 0) return { ok: false, error: "No slides to export" };

  // Show save dialog first so user can cancel before the slow capture
  const defaultName = sanitizePdfFileName(currentState.presentation?.title, "Mass") + ".pdf";
  const saveResult = await dialog.showSaveDialog(appWindow, {
    title: "Export Slides as PDF",
    defaultPath: path.join(os.homedir(), "Documents", defaultName),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, error: "Cancelled" };

  // Spin up parallel capture windows — capped to slide count so we never
  // create more windows than there are slides to process.
  const concurrency = Math.min(PDF_CAPTURE_CONCURRENCY, slides.length);
  const captureWindows = await Promise.all(
    Array.from({ length: concurrency }, () => createCaptureWindow())
  );

  const results = new Array(slides.length);
  let nextIndex = 0;
  let completed = 0;

  /**
   * Worker: repeatedly claims the next slide index from the shared queue,
   * renders it in `win`, waits for images, captures as JPEG, and stores
   * the result. Returns when the queue is exhausted.
   */
  async function runWorker(win) {
    while (true) {
      // Claim a slide index atomically (Node.js cooperative scheduling
      // means this increment is never interleaved with another worker).
      const i = nextIndex++;
      if (i >= slides.length) break;

      // Use the absolute index into the full slide list so the screen page's
      // render() and font-fit caches see the correct surrounding context.
      const absoluteIndex = allSlides.indexOf(slides[i]);
      const slideState = {
        ...currentState,
        currentSlideIndex: absoluteIndex,
        isBlack: false,
        countdownEndsAt: null
      };

      // Render the slide with transitions disabled for an instant paint.
      await win.webContents.executeJavaScript(`
        (function() {
          var state = ${JSON.stringify(slideState)};
          state.screenSettings = state.screenSettings || {};
          state.screenSettings.transition = 'none';
          if (typeof render === 'function') render(state);
        })();
      `);

      // Wait for two animation frames so Chromium's compositor has definitely
      // flushed the DOM change to the offscreen frame buffer before we settle.
      // A single rAF fires before paint; the second fires after the first paint,
      // guaranteeing the new pixels are in the buffer.
      await win.webContents.executeJavaScript(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
      );

      // Additional settle for image slides: the CSS background pipeline (raster →
      // GPU texture upload → composite) needs extra time beyond the rAF pair.
      const settleMs = slides[i]?.imageUrl ? PDF_IMAGE_SETTLE_MS : PDF_SETTLE_FLOOR_MS;
      await new Promise((r) => setTimeout(r, settleMs));

      const image = await win.webContents.capturePage();
      const frame = preset.width < 1920
        ? image.resize({ width: preset.width, height: preset.height, quality: "good" })
        : image;
      results[i] = frame.toJPEG(preset.jpegQuality);

      completed++;
      if (appWindow && !appWindow.isDestroyed()) {
        appWindow.webContents.executeJavaScript(
          `document.dispatchEvent(new CustomEvent('pdf-export-progress', { detail: { current: ${completed}, total: ${slides.length} } }))`
        );
      }
    }
  }

  try {
    await Promise.all(captureWindows.map(runWorker));
  } finally {
    captureWindows.forEach((win) => { if (!win.isDestroyed()) win.destroy(); });
  }

  // Assemble PDF in slide order using the preset output dimensions.
  const pdfDoc = await PDFDocument.create();
  for (const jpegBuf of results) {
    const jpgImage = await pdfDoc.embedJpg(jpegBuf);
    const { width, height } = preset;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(jpgImage, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(saveResult.filePath, Buffer.from(pdfBytes));

  // Open the folder containing the exported PDF
  shell.showItemInFolder(saveResult.filePath);

  return { ok: true, path: saveResult.filePath, slideCount: slides.length };
}

// ── Single-slide PDF export (Reading / Prayer / Hymn editor button) ──────────

async function exportSlidePdf(slides, screenSettings, suggestedName, quality) {
  const { PDFDocument } = require("pdf-lib");
  const preset = PDF_QUALITY_PRESETS[quality] || PDF_QUALITY_PRESETS.high;

  if (!slides || slides.length === 0) return { ok: false, error: "No slides to export" };

  const safeName = sanitizePdfFileName(suggestedName, "Slide");
  const saveResult = await dialog.showSaveDialog(appWindow, {
    title: "Export Slide as PDF",
    defaultPath: path.join(os.homedir(), "Documents", safeName + ".pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, error: "Cancelled" };

  const captureWin = await createCaptureWindow();
  const results = [];
  try {
    for (const slide of slides) {
      // Render each slide in isolation, matching the editor preview exactly:
      // single-element slides array + currentSlideIndex 0 means font-fit and
      // layout match what the preview showed rather than the full-deck context.
      const slideState = {
        presentation: { slides: [slide] },
        currentSlideIndex: 0,
        screenSettings: { ...screenSettings, transition: "none" },
        isBlack: false,
        countdownEndsAt: null
      };
      await captureWin.webContents.executeJavaScript(`
        (function() {
          var state = ${JSON.stringify(slideState)};
          if (typeof render === 'function') render(state);
        })();
      `);
      // Wait for two animation frames to guarantee Chromium has flushed the
      // DOM change into the offscreen frame buffer before we settle/capture.
      await captureWin.webContents.executeJavaScript(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
      );
      const settleMs = slide.imageUrl ? PDF_IMAGE_SETTLE_MS : PDF_SETTLE_FLOOR_MS;
      await new Promise((r) => setTimeout(r, settleMs));
      const image = await captureWin.webContents.capturePage();
      const frame = preset.width < 1920
        ? image.resize({ width: preset.width, height: preset.height, quality: "good" })
        : image;
      results.push(frame.toJPEG(preset.jpegQuality));

      if (appWindow && !appWindow.isDestroyed()) {
        const current = results.length;
        const total = slides.length;
        appWindow.webContents.executeJavaScript(
          `document.dispatchEvent(new CustomEvent('pdf-export-progress', { detail: { current: ${current}, total: ${total} } }))`
        );
      }
    }
  } finally {
    if (!captureWin.isDestroyed()) captureWin.destroy();
  }

  const pdfDoc = await PDFDocument.create();
  for (const jpegBuf of results) {
    const jpgImage = await pdfDoc.embedJpg(jpegBuf);
    const { width, height } = preset;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(jpgImage, { x: 0, y: 0, width, height });
  }
  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(saveResult.filePath, Buffer.from(pdfBytes));
  shell.showItemInFolder(saveResult.filePath);
  return { ok: true, path: saveResult.filePath, slideCount: results.length };
}

function setScreenFullscreen(on) {
  state.screenFullscreen = Boolean(on);
  saveSession(state);
  const windows = ensureConfiguredScreenWindows();
  if (windows.length === 0) return { ok: false };
  if (state.screenFullscreen) {
    fullscreenScreen();
  } else {
    for (const win of windows) {
      win.setFullScreen(false);
    }
  }
  updateFullscreenMenuLabel();
  return { ok: true };
}

// ── Application menu ──────────────────────────────────────────────────────────

function getFullscreenMenuLabel() {
  return state.screenFullscreen ? "Exit Screen Fullscreen" : "Enter Screen Fullscreen";
}

function updateFullscreenMenuLabel() {
  const menu = appMenu || Menu.getApplicationMenu();
  const item = menu?.getMenuItemById?.("toggle-screen-fullscreen");
  if (!item) return;
  item.label = getFullscreenMenuLabel();
}

const ipcHandlers = createIpcHandlers({
  dialog,
  screen,
  shell,
  fs,
  os,
  state,
  saveSession,
  syncTargetScreenState,
  ensureConfiguredScreenWindows,
  setScreenFullscreen,
  exportPdf: exportCurrentMassPdf,
  exportSlidePdf,
  getOwnerWindow: () => appWindow
});
registerIpcHandlers({ ipcMain, handlers: ipcHandlers });

function buildAppMenu(ioRef) {
  const isMac = process.platform === "darwin";
  const themeItems = listThemes().map(({ id, label }) => ({
    label,
    type: "radio",
    checked: state.appSettings?.theme === id,
    click: () => {
      const t = getTheme(id);
      if (!t) return;
      state.appSettings.theme = id;
      saveSession(state);
      if (ioRef) ioRef.emit("state:update", require("./state").getStateSnapshot());
    }
  }));

  const helpSubmenu = [
    {
      label: "Project Homepage",
      click: () => shell.openExternal(pkg.homepage)
    },
    {
      label: "Documentation Website",
      click: () => shell.openExternal(SITE_URL)
    },
    {
      label: "Report an Issue",
      click: () => shell.openExternal(pkg.bugs.url)
    }
  ];

  const fileSubmenu = [
    {
      label: "New Mass",
      accelerator: "CmdOrCtrl+N",
      click: () => clickAppButton("newMassBtn")
    },
    {
      label: "Save",
      accelerator: "CmdOrCtrl+S",
      click: () => {
        try {
          saveSession(state);
          saveCurrentMass();
          showAppStatus("Mass saved");
        } catch (error) {
          showAppStatus(error?.message || "Could not save the Mass.");
        }
      }
    },
    { type: "separator" },
    {
      label: "Mass Library",
      accelerator: "CmdOrCtrl+Shift+L",
      click: () => clickAppButton("massLibraryBtn")
    },
    {
      label: "Open Current Mass Folder",
      click: async () => {
        const massFolderPath = path.join(os.homedir(), ".sacra-lux", "current_mass");
        await fs.promises.mkdir(massFolderPath, { recursive: true });
        shell.openPath(massFolderPath);
      }
    },
    {
      label: "Reload Current Mass Folder",
      click: () => clickAppButton("reloadMassFolderBtn")
    },
    { type: "separator" },
    {
      label: "Import ZIP",
      accelerator: "CmdOrCtrl+Shift+O",
      click: () => clickAppButton("importZipBtn")
    },
    {
      label: "Export ZIP",
      accelerator: "CmdOrCtrl+Shift+E",
      click: () => runInAppWindow("window.location.href = '/api/export-mass-zip'")
    },
    {
      label: "Export PDF",
      click: () => clickAppButton("exportPdfBtn")
    },
    { type: "separator" },
    {
      label: "Duplicate Mass",
      click: () => clickAppButton("duplicateMassBtn")
    },
    { type: "separator" },
    isMac ? { role: "close" } : { role: "quit" }
  ];

  const viewSubmenu = [
    {
      label: "Themes",
      submenu: themeItems
    },
    { type: "separator" },
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" }
  ];

  const windowSubmenu = [
    {
      label: "Show App Window",
      accelerator: "CmdOrCtrl+1",
      click: () => showWindow(appWindow)
    },
    {
      label: "Show Screen Windows",
      accelerator: "CmdOrCtrl+2",
      click: () => {
        for (const win of ensureConfiguredScreenWindows()) {
          showWindow(win);
        }
      }
    },
    {
      label: "Open Remote Window",
      accelerator: "CmdOrCtrl+3",
      click: () => openOrFocusRemoteWindow(`http://localhost:${PORT}/remote`)
    },
    { type: "separator" },
    {
      id: "toggle-screen-fullscreen",
      label: getFullscreenMenuLabel(),
      accelerator: "CmdOrCtrl+Shift+F",
      click: () => {
        ensureConfiguredScreenWindows();
        if (!screenWindow || screenWindow.isDestroyed()) return;
        if (state.screenFullscreen) {
          state.screenFullscreen = false;
          for (const win of getScreenWindowList()) {
            win.setFullScreen(false);
          }
        } else {
          state.screenFullscreen = true;
          fullscreenScreen();
        }
        saveSession(state);
        updateFullscreenMenuLabel();
      }
    },
    { type: "separator" },
    { role: "minimize" },
    ...(isMac ? [{ role: "zoom" }, { type: "separator" }, { role: "front" }] : []),
    { role: "close" }
  ];

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            {
              label: "About Sacra Lux",
              click: () => { createSplash({ linkToSite: true }); }
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        }]
      : []),
    {
      label: "File",
      submenu: fileSubmenu
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: viewSubmenu
    },
    isMac
      ? {
          role: "windowMenu",
          submenu: windowSubmenu
        }
      : {
          label: "Window",
          submenu: windowSubmenu
        },
    {
      label: "Help",
      role: "help",
      submenu: [
        {
          label: "About Sacra Lux",
          click: () => { createSplash({ linkToSite: true }); }
        },
        { type: "separator" },
        ...helpSubmenu
      ]
    }
  ];

  appMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(appMenu);
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

// The start window closes on a click. The About window also opens the website.
function createSplash({ linkToSite = false } = {}) {
  splashWindow = new BrowserWindow({
    width: 430,
    height: 330,
    frame: false,
    backgroundColor: "#fffcf5",
    resizable: false,
    alwaysOnTop: true,
    center: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  lockWindow(splashWindow);

  // Read icon and encode as base64 data URL for the splash
  let iconDataUrl = "";
  try {
    const iconPath = path.join(__dirname, "..", "build", "icon-splash.png");
    const iconBuf = fs.readFileSync(iconPath);
    iconDataUrl = `data:image/png;base64,${iconBuf.toString("base64")}`;
  } catch { /* icon not available — skip */ }

  const buildDate = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric"
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {
    margin: 0; display: flex; align-items: center; justify-content: center;
    height: 100vh; background: #fffcf5; font-family: -apple-system, sans-serif;
    -webkit-app-region: drag; user-select: none;
  }
  .card {
    padding: 18px 28px 20px; text-align: center;
  }
  .icon { display: block; width: 290px; max-width: 100%; margin: 0 auto 8px; }
  .version { color: #546b89; font-size: 15px; margin: 0 0 3px; }
  .build-date { color: #78684d; font-size: 13px; margin: 0; }
</style></head><body>
<div class="card">
  ${iconDataUrl ? `<img class="icon" src="${iconDataUrl}">` : ""}
  <p class="version">Version ${pkg.version}</p>
  <p class="build-date">${buildDate}</p>
</div></body></html>`;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // Close splash on click or when it loses focus (blur only after main window is visible)
  const clickScript = linkToSite
    ? `document.addEventListener('click', () => { location.href = ${JSON.stringify(SITE_URL)}; })`
    : "document.addEventListener('click', () => window.close())";
  if (linkToSite) {
    const aboutWindow = splashWindow;
    aboutWindow.webContents.on("will-navigate", (event, url) => {
      if (url !== SITE_URL) return;
      shell.openExternal(SITE_URL);
      aboutWindow.close();
    });
  }
  splashWindow.webContents.on("did-finish-load", () => {
    splashWindow.webContents.executeJavaScript(clickScript);
  });
  splashWindow.on("blur", () => {
    if (splashWindow && !splashWindow.isDestroyed() && appWindow && appWindow.isVisible()) {
      splashWindow.close();
    }
  });
}

app.whenReady().then(async () => {
  createSplash();
  const splashCreatedAt = Date.now();
  const io = await startDesktopServer();
  buildAppMenu(io);

  // Create windows immediately — close splash once the app page loads
  // (or after a minimum 800ms splash time, whichever is later).
  createWindows();

  const showMainAndCloseSplash = () => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      appWindow.show();
      for (const win of ensureConfiguredScreenWindows()) {
        win.show();
      }
      return;
    }
    const elapsed = Date.now() - splashCreatedAt;
    const remaining = Math.max(0, 2000 - elapsed);
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      for (const win of ensureConfiguredScreenWindows()) {
        win.show();
      }
      appWindow.show();
    }, remaining);
  };

  appWindow.webContents.on("did-finish-load", showMainAndCloseSplash);

  // Restore saved screen preferences (target monitor + fullscreen)
  ensureConfiguredScreenWindows();
  if (state.screenFullscreen) {
    appWindow.webContents.on("did-finish-load", () => {
      setTimeout(() => fullscreenScreen(), 500);
    });
  }

  // Listen for state changes to auto-fullscreen the screen when Mass starts
  let _prevActive = false;
  io.on("connection", (socket) => {
    socket.on("disconnect", () => {}); // prevent unhandled listener warnings
  });
  // Hook into the server's outgoing state:update broadcasts
  const origEmit = io.emit.bind(io);
  io.emit = function(event, ...args) {
    if (event === "state:update" && args[0]) {
      const snap = args[0];
      const isActive = Boolean(snap.preMassRunning || snap.gatheringRunning || snap.postMassRunning);
      if (isActive && !_prevActive) {
        fullscreenScreen();
      }
      _prevActive = isActive;
    }
    return origEmit(event, ...args);
  };

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
}).catch((error) => {
  logger.error(`[desktop] Failed to start: ${error.message}`);
  dialog.showErrorBox("Sacra Lux could not start", error.message);
  app.quit();
});

app.on("before-quit", () => {
  flushPendingSave();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
