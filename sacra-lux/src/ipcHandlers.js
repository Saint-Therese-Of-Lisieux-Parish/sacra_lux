const path = require("path");

const IPC_CHANNELS = Object.freeze([
  "dialog:pickFolder",
  "dialog:pickImageFile",
  "dialog:pickVideoFile",
  "screen:getMonitors",
  "screen:setTargetMonitor",
  "screen:setTargetMonitors",
  "screen:fullscreen",
  "folder:openMassFolder",
  "export:pdf",
  "export:slide-pdf"
]);

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml"
});

const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const PDF_QUALITY_PRESETS = new Set(["high", "medium", "small"]);

function inputError(message) {
  return { error: message };
}

function operationError(message) {
  return { ok: false, error: message };
}

function acceptsNoInput(args) {
  return args.length === 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidPhases(phases) {
  if (phases == null) return true;
  return Array.isArray(phases) && phases.every((phase) => typeof phase === "string" && phase.trim() !== "");
}

function isValidQuality(quality) {
  return quality === undefined || PDF_QUALITY_PRESETS.has(quality);
}

function isValidSlides(slides) {
  return Array.isArray(slides) && slides.length > 0 && slides.every(isPlainObject);
}

function requireDependency(dependencies, name) {
  const value = dependencies[name];
  if (!value) throw new Error(`The IPC handler dependency "${name}" is required.`);
  return value;
}

function createIpcHandlers(dependencies = {}) {
  const dialog = requireDependency(dependencies, "dialog");
  const screen = requireDependency(dependencies, "screen");
  const shell = requireDependency(dependencies, "shell");
  const fs = requireDependency(dependencies, "fs");
  const os = requireDependency(dependencies, "os");
  const state = requireDependency(dependencies, "state");
  const saveSession = requireDependency(dependencies, "saveSession");
  const syncTargetScreenState = requireDependency(dependencies, "syncTargetScreenState");
  const ensureConfiguredScreenWindows = requireDependency(dependencies, "ensureConfiguredScreenWindows");
  const setScreenFullscreen = requireDependency(dependencies, "setScreenFullscreen");
  const exportPdf = requireDependency(dependencies, "exportPdf");
  const exportSlidePdf = requireDependency(dependencies, "exportSlidePdf");
  const getOwnerWindow = requireDependency(dependencies, "getOwnerWindow");

  async function pickFolder(...args) {
    if (!acceptsNoInput(args)) return inputError("This channel accepts no input.");
    const result = await dialog.showOpenDialog(getOwnerWindow(), {
      title: "Select Readings Folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }

  async function pickImageFile(...args) {
    if (!acceptsNoInput(args)) return inputError("This channel accepts no input.");
    const result = await dialog.showOpenDialog(getOwnerWindow(), {
      title: "Select Image",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: Object.keys(IMAGE_MIME_BY_EXTENSION) }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const name = path.basename(filePath);
    const extension = path.extname(filePath).slice(1).toLowerCase();
    const mime = IMAGE_MIME_BY_EXTENSION[extension];
    if (!mime) return inputError("The selected file is not a supported image.");

    const buffer = fs.readFileSync(filePath);
    if (!Buffer.isBuffer(buffer)) return inputError("The selected image could not be read.");
    return { name, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
  }

  async function pickVideoFile(...args) {
    if (!acceptsNoInput(args)) return inputError("This channel accepts no input.");
    const result = await dialog.showOpenDialog(getOwnerWindow(), {
      title: "Select Video",
      properties: ["openFile"],
      filters: [{ name: "MP4 Video", extensions: ["mp4"] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    if (path.extname(filePath).toLowerCase() !== ".mp4") {
      return inputError("The selected file is not an MP4 video.");
    }

    const stats = fs.statSync(filePath);
    if (!stats || typeof stats.size !== "number") {
      return inputError("The selected video could not be read.");
    }
    if (stats.size > VIDEO_MAX_BYTES) {
      return inputError("Video file exceeds the 500 MB limit. Please use a smaller file.");
    }

    const buffer = fs.readFileSync(filePath);
    if (!Buffer.isBuffer(buffer)) return inputError("The selected video could not be read.");
    return {
      name: path.basename(filePath),
      dataUrl: `data:video/mp4;base64,${buffer.toString("base64")}`
    };
  }

  function getMonitors(...args) {
    if (!acceptsNoInput(args)) return inputError("This channel accepts no input.");
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return displays.map((display) => ({
      id: display.id,
      label: `${display.bounds.width}x${display.bounds.height}` +
        (display.id === primary.id ? " (Primary)" : "") +
        ` @ ${display.bounds.x},${display.bounds.y}`,
      isPrimary: display.id === primary.id,
      bounds: display.bounds
    }));
  }

  function setTargetMonitor(...args) {
    const [screenId] = args;
    if (screenId !== null && !Number.isFinite(screenId)) {
      return operationError("The monitor ID must be a number or null.");
    }

    syncTargetScreenState(screenId === null ? [] : [screenId]);
    saveSession(state);
    ensureConfiguredScreenWindows();
    return {
      ok: true,
      targetScreenId: state.targetScreenId,
      targetScreenIds: state.targetScreenIds
    };
  }

  function setTargetMonitors(...args) {
    const [screenIds] = args;
    if (!Array.isArray(screenIds) || !screenIds.every(Number.isFinite)) {
      return operationError("The monitor IDs must be an array of numbers.");
    }

    syncTargetScreenState(screenIds);
    saveSession(state);
    ensureConfiguredScreenWindows();
    return {
      ok: true,
      targetScreenId: state.targetScreenId,
      targetScreenIds: state.targetScreenIds
    };
  }

  function changeScreenFullscreen(...args) {
    const [on] = args;
    if (typeof on !== "boolean") {
      return operationError("The fullscreen value must be a boolean.");
    }
    return setScreenFullscreen(on);
  }

  async function openMassFolder(...args) {
    if (!acceptsNoInput(args)) return inputError("This channel accepts no input.");
    const massFolderPath = path.join(os.homedir(), ".sacra-lux", "current_mass");
    await fs.promises.mkdir(massFolderPath, { recursive: true });
    return shell.openPath(massFolderPath);
  }

  async function exportCurrentMassPdf(...args) {
    const [phases, quality] = args;
    if (!isValidPhases(phases)) {
      return operationError("The phases must be an array of non-empty strings.");
    }
    if (!isValidQuality(quality)) {
      return operationError("The PDF quality must be high, medium, or small.");
    }
    return exportPdf(phases, quality);
  }

  async function exportSlidesPdf(...args) {
    const [slides, screenSettings, suggestedName, quality] = args;
    if (!isValidSlides(slides)) {
      return operationError("The slides must be a non-empty array of slide objects.");
    }
    if (!isPlainObject(screenSettings)) {
      return operationError("The screen settings must be an object.");
    }
    if (typeof suggestedName !== "string" || suggestedName.trim() === "") {
      return operationError("The suggested name must be a non-empty string.");
    }
    if (!isValidQuality(quality)) {
      return operationError("The PDF quality must be high, medium, or small.");
    }
    return exportSlidePdf(slides, screenSettings, suggestedName, quality);
  }

  return Object.freeze({
    "dialog:pickFolder": pickFolder,
    "dialog:pickImageFile": pickImageFile,
    "dialog:pickVideoFile": pickVideoFile,
    "screen:getMonitors": getMonitors,
    "screen:setTargetMonitor": setTargetMonitor,
    "screen:setTargetMonitors": setTargetMonitors,
    "screen:fullscreen": changeScreenFullscreen,
    "folder:openMassFolder": openMassFolder,
    "export:pdf": exportCurrentMassPdf,
    "export:slide-pdf": exportSlidesPdf
  });
}

function registerIpcHandlers({ ipcMain, handlers }) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("An Electron ipcMain object is required.");
  }
  if (!handlers) throw new Error("IPC handlers are required.");

  for (const channel of IPC_CHANNELS) {
    const handler = handlers[channel];
    if (typeof handler !== "function") {
      throw new Error(`The IPC channel "${channel}" has no handler.`);
    }
    ipcMain.handle(channel, (event, ...args) => handler(...args));
  }

  return handlers;
}

module.exports = {
  IPC_CHANNELS,
  createIpcHandlers,
  registerIpcHandlers
};
