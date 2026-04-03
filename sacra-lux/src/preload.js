/**
 * Electron preload script.
 * Expose the allowed renderer API through contextBridge.
 * Keep this surface limited to features that need native access.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  /**
   * Open the native folder picker.
   * Return the selected folder path, or null if cancelled.
   */
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),

  /**
   * Open the native image picker.
   * Return { name, dataUrl }, or null if cancelled.
   */
  pickImageFile: () => ipcRenderer.invoke("dialog:pickImageFile"),

  /**
   * List available screen monitors.
   * Return [{ id, label, isPrimary, bounds }].
   */
  getMonitors: () => ipcRenderer.invoke("screen:getMonitors"),

  /**
   * Set the target monitor for the screen window.
   * Pass a screen ID, or null to unset.
   */
  setTargetMonitor: (screenId) => ipcRenderer.invoke("screen:setTargetMonitor", screenId),

  /**
   * Set the full set of target monitors for screen windows.
   * Pass an array of screen IDs.
   */
  setTargetMonitors: (screenIds) => ipcRenderer.invoke("screen:setTargetMonitors", screenIds),

  /**
   * Toggle fullscreen on the screen window.
   */
  setScreenFullscreen: (on) => ipcRenderer.invoke("screen:fullscreen", on),

  /**
   * Open the current Mass folder in Finder.
   * Return an empty string on success or an error string.
   */
  openMassFolder: () => ipcRenderer.invoke("folder:openMassFolder"),

  /**
   * Export slides as a PDF file.
   * Pass null or omit phases to export the full deck.
   * Return { ok, path, slideCount } or { ok: false, error }.
   */
  exportPdf: (phases, quality) => ipcRenderer.invoke("export:pdf", phases, quality),
  exportSlidePdf: (slides, screenSettings, suggestedName, quality) =>
    ipcRenderer.invoke("export:slide-pdf", slides, screenSettings, suggestedName, quality),

  /**
   * Indicate whether the app is running inside Electron.
   */
  isElectron: true
});
