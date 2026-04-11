const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
// Load adm-zip lazily.
let _AdmZip;
function getAdmZip() {
  if (!_AdmZip) _AdmZip = require("adm-zip");
  return _AdmZip;
}

const { importReadings, paginateDocuments } = require("./readingsImporter");
const {
  ValidationError,
  buildMassDocumentFromLegacyPackage,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  isMassDocumentV3,
  serializeReadingDocument
} = require("./massDocument");
const { state, getSafeSlideIndex, touch, getStateSnapshot } = require("./state");
const {
  createDefaultOrganizer,
  buildPresentationFromOrganizer,
  createManualSlideRecord,
  normalizeBackgroundTheme,
  normalizePhase,
  normalizeType
} = require("./organizer");
const { saveSession, loadSession, getSessionFilePath } = require("./persistence");
const { themes: allThemes, getTheme, listThemes, DEFAULT_THEME } = require("./themes");
const logger = require("./logger");
const {
  CURRENT_MASS_DIR,
  sanitizeForFilename,
  getArchivePaths,
  readMetadata,
  writeMetadata,
  syncCurrentMassToArchive,
  listMassArchives,
  deleteMassArchive
} = require("./massHistory");
const {
  PIN_HASH_DIGEST,
  PIN_HASH_ITERATIONS,
  RATE_LIMIT_CONFIG,
  clearPinFailures,
  clearStartToken,
  createConcurrentLimitMiddleware,
  createPinHashRecord,
  createRateLimitMiddleware,
  createSocketRateLimitGuard,
  getActiveLock,
  getClientIp,
  hasPinConfigured,
  isStartTokenValid,
  issueStartToken,
  registerPinFailure,
  verifyPin
} = require("./security");

const GOOGLE_FONTS = new Set([
  "Merriweather",
  "Lora",
  "Playfair Display",
  "Cormorant Garamond",
  "EB Garamond",
  "Libre Baskerville",
  "Crimson Pro",
  "Noto Serif",
  "PT Serif",
  "Source Sans 3",
  "Inter",
  "Open Sans",
  "Roboto",
  "Work Sans",
  "Noto Sans",
  "PT Sans",
  "Montserrat",
  "Poppins",
  "Raleway"
]);

const logInfo = logger.info;
const logWarn = logger.warn;
const DEFAULT_SCREEN_SETTINGS = structuredClone(state.screenSettings);

// ── ZIP export helpers ───────────────────────────────────────────────────────

/**
 * Copy readings into `~/.sacra-lux/current_mass/`.
 * Clear the destination first so it always matches the active Mass.
 * Return the current_mass path.
 */
function copyReadingsToCurrentMass(srcFolder) {
  // Clear the existing contents.
  if (fs.existsSync(CURRENT_MASS_DIR)) {
    fs.rmSync(CURRENT_MASS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });

  // Copy top-level files.
  for (const file of fs.readdirSync(srcFolder)) {
    const srcPath = path.join(srcFolder, file);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, path.join(CURRENT_MASS_DIR, file));
    }
  }

  // Copy the assets subdirectory when present.
  const srcAssets = path.join(srcFolder, "assets");
  if (fs.existsSync(srcAssets) && fs.statSync(srcAssets).isDirectory()) {
    const destAssets = path.join(CURRENT_MASS_DIR, "assets");
    fs.mkdirSync(destAssets, { recursive: true });
    for (const file of fs.readdirSync(srcAssets)) {
      const srcPath = path.join(srcAssets, file);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, path.join(destAssets, file));
      }
    }
  }

  return CURRENT_MASS_DIR;
}

/**
 * Save the current Mass state into `~/.sacra-lux/current_mass/mass.json`.
 * Keep current_mass as a self-contained package.
 */
function syncReadingsDocumentsToCurrentMass(documents = [], title = null) {
  fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });

  for (const file of fs.readdirSync(CURRENT_MASS_DIR)) {
    if (file.endsWith(".txt")) {
      fs.rmSync(path.join(CURRENT_MASS_DIR, file), { force: true });
    }
  }

  if (title && String(title).trim()) {
    fs.writeFileSync(path.join(CURRENT_MASS_DIR, "mass_title.txt"), `${String(title).trim()}\n`, "utf8");
  }

  for (const doc of documents) {
    fs.writeFileSync(
      path.join(CURRENT_MASS_DIR, `${doc.stem}.txt`),
      serializeReadingDocument(doc),
      "utf8"
    );
  }
}

function saveCurrentMass() {
  fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
  syncReadingsDocumentsToCurrentMass(state.readingsSource?.documents || [], state.presentation?.title || null);
  const massData = buildMassDocumentFromState(state);
  fs.writeFileSync(
    path.join(CURRENT_MASS_DIR, "mass.json"),
    JSON.stringify(massData, null, 2),
    "utf8"
  );
  const archive = syncCurrentMassToArchive({
    currentArchiveId: state.activeMassArchiveId,
    title: state.presentation?.title,
    startTime: state.massStartTime
  });
  state.activeMassArchiveId = archive.id;
  logInfo(`[save] Mass saved to ${CURRENT_MASS_DIR}`);
}

function buildExportFilename(title, startTime, suffix = ".zip") {
  const titlePart = sanitizeForFilename(title) || "Mass";
  const timePart = String(startTime || "")
    .replace(/[:]/g, "")
    .replace(/[^0-9T-]/g, "")
    .replace("T", "-") || "unscheduled";
  return `${titlePart}-${timePart}${suffix}`;
}

function buildAsciiAttachmentFilename(filename) {
  const normalized = String(filename || "download")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\]/g, "")
    .replace(/[;]+/g, "-")
    .trim();
  return normalized || "download";
}

function setAttachmentFilename(res, filename) {
  const safeFilename = String(filename || "download");
  const asciiFilename = buildAsciiAttachmentFilename(safeFilename);
  const encodedFilename = encodeURIComponent(safeFilename)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
  );
}

function sendApiError(res, error, fallbackMessage) {
  const status = error instanceof ValidationError ? 400 : 500;
  return res.status(status).json({ error: error.message || fallbackMessage });
}

function getSafeZipEntryFilename(entryName, prefix, allowedPattern) {
  const normalizedEntry = path.posix.normalize(String(entryName || ""));
  if (!normalizedEntry.startsWith(prefix) || normalizedEntry.endsWith("/")) {
    return null;
  }

  const relativePath = normalizedEntry.slice(prefix.length);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes("/")) {
    return null;
  }

  return allowedPattern.test(relativePath) ? relativePath : null;
}

function loadReadingsFromFolder(folderPath, screenSettings) {
  const hasReadings = fs.existsSync(folderPath) &&
    fs.readdirSync(folderPath).some((file) => file.endsWith(".txt"));
  if (!hasReadings) {
    return [];
  }

  const imported = importReadings(folderPath, {
    fontSizePx: screenSettings.fontSizePx,
    fontFamily: screenSettings.fontFamily,
    readingTextHeightPx: screenSettings.readingTextHeightPx
  });
  return imported.documents || [];
}

function readMassPackageDefinition(packageDir, screenSettings = DEFAULT_SCREEN_SETTINGS) {
  const massJsonPath = path.join(packageDir, "mass.json");
  if (!fs.existsSync(massJsonPath)) {
    throw new Error("Archive package is missing mass.json.");
  }

  const packageData = JSON.parse(fs.readFileSync(massJsonPath, "utf8"));
  if (isMassDocumentV3(packageData)) {
    return {
      kind: "v3",
      raw: packageData,
      runtime: buildRuntimeStateFromMassDocument(packageData)
    };
  }

  const documents = fs.existsSync(packageDir)
    ? loadReadingsFromFolder(packageDir, screenSettings)
    : [];
  if (packageData.massStartTime != null && Number.isNaN(new Date(String(packageData.massStartTime)).getTime())) {
    throw new ValidationError("massStartTime must be a valid datetime string.");
  }
  const screenSettingsInput = packageData.screenSettings || packageData.displaySettings || screenSettings;
  return {
    kind: "legacy",
    raw: packageData,
    runtime: {
      presentationTitle: packageData.presentationTitle || "Mass Presentation",
      massStartTime: packageData.massStartTime || null,
      screenSettings: screenSettingsInput,
      organizerSequence: packageData.organizerSequence || [],
      manualSlides: packageData.manualSlides || packageData.manualCues || {},
      documents
    }
  };
}

async function buildMassZipFromPackage(packageDir, { avif = false } = {}) {
  const zip = new (getAdmZip())();
  const packageInfo = readMassPackageDefinition(packageDir);
  const urlRemap = new Map();
  let sharp = null;
  if (avif) {
    sharp = require("sharp");
  }

  const refs = [];
  if (packageInfo.kind === "v3") {
    for (const item of packageInfo.raw.items || []) {
      if (item.asset?.ref) refs.push(item.asset.ref);
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (packageInfo.raw.presentationDefaults?.[key]) refs.push(packageInfo.raw.presentationDefaults[key]);
    }
  } else {
    for (const slide of Object.values(packageInfo.raw.manualSlides || {})) {
      if (slide.imageUrl) refs.push(slide.imageUrl);
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (packageInfo.raw.screenSettings?.[key]) refs.push(packageInfo.raw.screenSettings[key]);
    }
  }

  const CONVERTIBLE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif"]);
  for (const ref of refs) {
    let filePath = null;
    let originalName = null;

    const assetRefMatch = String(ref).match(/^assets\/([^/]+)$/);
    if (assetRefMatch) {
      originalName = assetRefMatch[1];
      filePath = path.join(packageDir, "assets", originalName);
    }
    const assetMatch = String(ref).match(/\/api\/mass-asset\/([^/]+)$/);
    if (assetMatch) {
      originalName = assetMatch[1];
      filePath = path.join(packageDir, "assets", originalName);
    }
    const uploadMatch = String(ref).match(/\/static\/uploads\/([^/]+)$/);
    if (uploadMatch) {
      originalName = uploadMatch[1];
      filePath = path.join(packageDir, "uploads", originalName);
    }
    if (!filePath || !originalName || !fs.existsSync(filePath)) continue;
    const ext = path.extname(originalName).toLowerCase();

    if (avif && CONVERTIBLE_EXT.has(ext)) {
      const avifName = `${path.basename(originalName, ext)}.avif`;
      zip.addFile(`assets/${avifName}`, await sharp(filePath).avif({ quality: 50 }).toBuffer());
      urlRemap.set(ref, `assets/${avifName}`);
    } else {
      zip.addFile(`assets/${originalName}`, fs.readFileSync(filePath));
    }
  }

  if (packageInfo.kind === "v3") {
    const massDocument = structuredClone(packageInfo.raw);
    for (const item of massDocument.items || []) {
      if (item.asset?.ref && urlRemap.has(item.asset.ref)) {
        item.asset.ref = urlRemap.get(item.asset.ref);
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (massDocument.presentationDefaults?.[key] && urlRemap.has(massDocument.presentationDefaults[key])) {
        massDocument.presentationDefaults[key] = urlRemap.get(massDocument.presentationDefaults[key]);
      }
    }
    zip.addFile("mass.json", Buffer.from(JSON.stringify(massDocument, null, 2)));
  } else {
    const documents = fs.existsSync(packageDir) ? loadReadingsFromFolder(packageDir, packageInfo.runtime.screenSettings) : [];
    const massDocument = buildMassDocumentFromLegacyPackage(
      packageInfo.raw,
      documents,
      packageInfo.raw.screenSettings || packageInfo.raw.displaySettings || packageInfo.runtime.screenSettings
    );
    for (const item of massDocument.items || []) {
      if (item.asset?.ref && urlRemap.has(item.asset.ref)) {
        item.asset.ref = urlRemap.get(item.asset.ref);
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (massDocument.presentationDefaults?.[key] && urlRemap.has(massDocument.presentationDefaults[key])) {
        massDocument.presentationDefaults[key] = urlRemap.get(massDocument.presentationDefaults[key]);
      }
    }
    zip.addFile("mass.json", Buffer.from(JSON.stringify(massDocument, null, 2)));
  }

  const assetsDir = path.join(packageDir, "assets");
  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      const fullPath = path.join(assetsDir, file);
      if (fs.statSync(fullPath).isFile() && !zip.getEntry(`assets/${file}`)) {
        zip.addFile(`assets/${file}`, fs.readFileSync(fullPath));
      }
    }
  }

  return zip.toBuffer();
}

function applyMassPackageFromCurrentDir(ioRef, packageData) {
  const runtime = isMassDocumentV3(packageData)
    ? buildRuntimeStateFromMassDocument(packageData)
    : {
      presentationTitle: packageData.presentationTitle || "Mass Presentation",
      massStartTime: packageData.massStartTime || null,
      screenSettings: packageData.screenSettings || packageData.displaySettings || DEFAULT_SCREEN_SETTINGS,
      organizerSequence: packageData.organizerSequence || [],
      manualSlides: packageData.manualSlides || packageData.manualCues || {},
      documents: loadReadingsFromFolder(CURRENT_MASS_DIR, normalizeScreenSettings(packageData.screenSettings || packageData.displaySettings || DEFAULT_SCREEN_SETTINGS))
    };

  state.screenSettings = normalizeScreenSettings(DEFAULT_SCREEN_SETTINGS);
  state.organizerSequence = [];
  state.manualSlides = {};
  state.readingsSource = { folderPath: CURRENT_MASS_DIR, documents: [] };
  state.massStartTime = null;

  state.screenSettings = normalizeScreenSettings(runtime.screenSettings || DEFAULT_SCREEN_SETTINGS);
  state.organizerSequence = normalizeOrganizerSequence(runtime.organizerSequence || []);
  state.manualSlides = mergeManualSlideState(state.organizerSequence, runtime.manualSlides || {});
  propagateInterstitialImage(state.organizerSequence, state.manualSlides);

  const documents = Array.isArray(runtime.documents) && runtime.documents.length > 0
    ? runtime.documents
    : loadReadingsFromFolder(CURRENT_MASS_DIR, state.screenSettings);
  if (documents.length > 0) {
    syncReadingsDocumentsToCurrentMass(documents, runtime.presentationTitle || null);
  }
  state.readingsSource = { folderPath: CURRENT_MASS_DIR, documents };
  state.presentation = buildPresentationFromOrganizer({
    title: runtime.presentationTitle || "Mass Presentation",
    documents,
    sequence: state.organizerSequence,
    manualSlides: state.manualSlides,
    screenSettings: state.screenSettings
  });

  if (runtime.massStartTime && typeof runtime.massStartTime === "string") {
    state.massStartTime = runtime.massStartTime;
    scheduleStartTimer(ioRef);
  } else {
    state.massStartTime = null;
    if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
  }

  state.currentSlideIndex = getSafeSlideIndex(0);
  resetDisplayOverrides();
  state.preMassRunning = false;
  stopPreMassTimer();
  stopGatheringTimer();
  stopPostMassTimer();
  touch();
  ioRef.emit("state:update", getStateSnapshot());
}

function normalizeScreenSettings(input = {}) {
  const current = state.screenSettings;
  const darkBackgroundUrl = input.darkBackgroundUrl ?? input.colorBackgroundUrl ?? input.wordBackgroundUrl;
  const lightBackgroundUrl = input.lightBackgroundUrl ?? input.imageBackgroundUrl ?? input.graphicBackgroundUrl;
  const requestedFamily = String(input.fontFamily || current.fontFamily || "Merriweather");
  const fontFamily = GOOGLE_FONTS.has(requestedFamily) ? requestedFamily : "Merriweather";
  const readingTextAlign = ["left", "center", "right"].includes(String(input.readingTextAlign || current.readingTextAlign || "left"))
    ? String(input.readingTextAlign || current.readingTextAlign || "left")
    : "left";
  const readingTextVAlign = ["top", "middle", "bottom"].includes(String(input.readingTextVAlign || current.readingTextVAlign || "middle"))
    ? String(input.readingTextVAlign || current.readingTextVAlign || "middle")
    : "middle";
  const readingTextFontRaw = String(input.readingTextFont ?? current.readingTextFont ?? "");
  const readingTextFont = GOOGLE_FONTS.has(readingTextFontRaw) ? readingTextFontRaw : "";
  const readingTextSizePx = Math.min(200, Math.max(0, Number(input.readingTextSizePx ?? current.readingTextSizePx ?? 0)));
  const readingPassageFontRaw = String(input.readingPassageFont ?? current.readingPassageFont ?? "Source Sans 3");
  const readingPassageFont = GOOGLE_FONTS.has(readingPassageFontRaw) ? readingPassageFontRaw : "Source Sans 3";
  const readingPassagePosition = ["top", "bottom"].includes(String(input.readingPassagePosition || current.readingPassagePosition || "top"))
    ? String(input.readingPassagePosition || current.readingPassagePosition || "top")
    : "top";
  const readingPassageAlign = ["left", "center", "right"].includes(String(input.readingPassageAlign || current.readingPassageAlign || "center"))
    ? String(input.readingPassageAlign || current.readingPassageAlign || "center")
    : "center";
  const VALID_RESOLUTIONS = ["720p", "1080p", "1440p", "4k"];
  const resolution = VALID_RESOLUTIONS.includes(String(input.resolution || current.resolution || ""))
    ? String(input.resolution || current.resolution)
    : "1080p";

  const VALID_TRANSITIONS = ["none", "fade"];
  const transition = VALID_TRANSITIONS.includes(String(input.transition || current.transition || ""))
    ? String(input.transition || current.transition)
    : "fade";

  return {
    fontFamily,
    fontSizePx: Math.min(200, Math.max(24, Number(input.fontSizePx) || current.fontSizePx || 60)),
    darkBackgroundUrl: String(
      darkBackgroundUrl || current.darkBackgroundUrl || "/static/assets/background-dark.png"
    ),
    lightBackgroundUrl: String(
      lightBackgroundUrl || current.lightBackgroundUrl || "/static/assets/background-graphic.png"
    ),
    boldText: Boolean(input.boldText ?? current.boldText ?? false),
    resolution,
    transition,
    readingTextAlign,
    readingTextVAlign,
    readingTextFont,
    readingTextSizePx,
    readingTextBold: Boolean(input.readingTextBold ?? current.readingTextBold ?? false),
    readingTextColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingTextColor || "")) ? String(input.readingTextColor) : (current.readingTextColor || "#f8f8f8"),
    readingPassagePosition,
    readingPassageAlign,
    readingPassageFont,
    readingPassageSizePx: Math.min(90, Math.max(20, Number(input.readingPassageSizePx) || current.readingPassageSizePx || 44)),
    readingPassageBold: Boolean(input.readingPassageBold ?? current.readingPassageBold ?? true),
    readingPassageColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingPassageColor || "")) ? String(input.readingPassageColor) : (current.readingPassageColor || "#e8d5a0"),
    readingPassageOutline: Boolean(input.readingPassageOutline ?? current.readingPassageOutline ?? false),
    readingPassageOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingPassageOutlineColor || "")) ? String(input.readingPassageOutlineColor) : (current.readingPassageOutlineColor || "#000000"),
    readingPassageOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, Number(input.readingPassageOutlineWidthPx ?? current.readingPassageOutlineWidthPx ?? 1))) * 10) / 10,
    readingSectionOutline: Boolean(input.readingSectionOutline ?? current.readingSectionOutline ?? false),
    readingSectionOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingSectionOutlineColor || "")) ? String(input.readingSectionOutlineColor) : (current.readingSectionOutlineColor || "#000000"),
    readingSectionOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, Number(input.readingSectionOutlineWidthPx ?? current.readingSectionOutlineWidthPx ?? 1))) * 10) / 10,
    readingShowPageNumber: Boolean(input.readingShowPageNumber ?? current.readingShowPageNumber ?? true),
    readingShowLabel: Boolean(input.readingShowLabel ?? current.readingShowLabel ?? true),
    readingTextMarginXPx: Math.min(260, Math.max(0, Number(input.readingTextMarginXPx) || current.readingTextMarginXPx || 80)),
    readingTextMarginYPx: Math.min(360, Math.max(0, Number(input.readingTextMarginYPx) || current.readingTextMarginYPx || 130)),
    readingTextHeightPx: Math.min(980, Math.max(120, Number(input.readingTextHeightPx) || current.readingTextHeightPx || 840)),
    readingPassageYPx: Math.min(1060, Math.max(0, Number(input.readingPassageYPx) || current.readingPassageYPx || 70)),
    readingPassageWidthPx: Math.min(1760, Math.max(180, Number(input.readingPassageWidthPx) || current.readingPassageWidthPx || 650)),
    readingLineHeight: Math.round(Math.min(3.0, Math.max(1.0, Number(input.readingLineHeight) || current.readingLineHeight || 1.58)) * 100) / 100,
    readingLetterSpacingPx: Math.round(Math.min(10, Math.max(-2, Number(input.readingLetterSpacingPx ?? current.readingLetterSpacingPx ?? 0))) * 10) / 10,
    readingTextItalic: Boolean(input.readingTextItalic ?? current.readingTextItalic ?? false),
    readingTextOutline: Boolean(input.readingTextOutline ?? current.readingTextOutline ?? false),
    readingTextOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingTextOutlineColor || "")) ? String(input.readingTextOutlineColor) : (current.readingTextOutlineColor || "#000000"),
    readingTextOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, Number(input.readingTextOutlineWidthPx ?? current.readingTextOutlineWidthPx ?? 1))) * 10) / 10,
    readingTextShadow: Boolean(input.readingTextShadow ?? current.readingTextShadow ?? true),
    // Text/Prayer/Hymn slide layout
    textSlideTextAlign: ["left", "center", "right"].includes(String(input.textSlideTextAlign || current.textSlideTextAlign || "center"))
      ? String(input.textSlideTextAlign || current.textSlideTextAlign || "center") : "center",
    textSlideTextVAlign: ["top", "middle", "bottom"].includes(String(input.textSlideTextVAlign || current.textSlideTextVAlign || "middle"))
      ? String(input.textSlideTextVAlign || current.textSlideTextVAlign || "middle") : "middle",
    textSlideTextFont: GOOGLE_FONTS.has(String(input.textSlideTextFont ?? current.textSlideTextFont ?? ""))
      ? String(input.textSlideTextFont ?? current.textSlideTextFont ?? "") : "",
    textSlideTextSizePx: Math.min(200, Math.max(0, Number(input.textSlideTextSizePx ?? current.textSlideTextSizePx ?? 0))),
    textSlideTextBold: Boolean(input.textSlideTextBold ?? current.textSlideTextBold ?? false),
    textSlideTextItalic: Boolean(input.textSlideTextItalic ?? current.textSlideTextItalic ?? false),
    textSlideTextColor: /^#[0-9a-fA-F]{6}$/.test(String(input.textSlideTextColor || "")) ? String(input.textSlideTextColor) : (current.textSlideTextColor || "#f8f8f8"),
    textSlideLineHeight: Math.round(Math.min(3.0, Math.max(1.0, Number(input.textSlideLineHeight) || current.textSlideLineHeight || 1.55)) * 100) / 100,
    textSlideLetterSpacingPx: Math.round(Math.min(10, Math.max(-2, Number(input.textSlideLetterSpacingPx ?? current.textSlideLetterSpacingPx ?? 0))) * 10) / 10,
    textSlideTextOutline: Boolean(input.textSlideTextOutline ?? current.textSlideTextOutline ?? false),
    textSlideTextOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.textSlideTextOutlineColor || "")) ? String(input.textSlideTextOutlineColor) : (current.textSlideTextOutlineColor || "#000000"),
    textSlideTextOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, Number(input.textSlideTextOutlineWidthPx ?? current.textSlideTextOutlineWidthPx ?? 1))) * 10) / 10,
    textSlideTextShadow: Boolean(input.textSlideTextShadow ?? current.textSlideTextShadow ?? true),
    textSlideShowPageNumber: Boolean(input.textSlideShowPageNumber ?? current.textSlideShowPageNumber ?? true),
    textSlideMarginXPx: Math.min(400, Math.max(0, Number(input.textSlideMarginXPx) || current.textSlideMarginXPx || 110)),
    textSlideMarginYPx: Math.min(400, Math.max(0, Number(input.textSlideMarginYPx) || current.textSlideMarginYPx || 90)),
    textSlideTextHeightPx: Math.min(1020, Math.max(120, Number(input.textSlideTextHeightPx) || current.textSlideTextHeightPx || 900))
  };
}

function repaginateReadingSlidesIfNeeded() {
  if (!Array.isArray(state.readingsSource.documents) || state.readingsSource.documents.length === 0) {
    return;
  }

  state.presentation = buildPresentationFromOrganizer({
    title: state.presentation.title,
    documents: state.readingsSource.documents,
    sequence: state.organizerSequence,
    manualSlides: state.manualSlides,
    screenSettings: state.screenSettings
  });
  state.currentSlideIndex = getSafeSlideIndex(state.currentSlideIndex);
  invalidateStateCache();
}

function mergeManualSlideState(nextSequence, nextManualSlides) {
  const merged = {};

  for (const item of nextSequence) {
    if (item.type === "reading") {
      continue;
    }

    merged[item.id] = {
      ...createManualSlideRecord(item.type),
      ...(state.manualSlides[item.id] || {}),
      ...(nextManualSlides[item.id] || {})
    };
  }

  return merged;
}

/**
 * When any interstitial slide's image changes, propagate to all other interstitials.
 * Mutates mergedManualSlides in place.
 */
function propagateInterstitialImage(sequence, mergedManualSlides) {
  const interstitialIds = sequence
    .filter((item) => item.type === "interstitial")
    .map((item) => item.id);
  if (interstitialIds.length < 2) return;

  // Find which interstitial had its image changed vs previous state
  let changedUrl = null;
  for (const id of interstitialIds) {
    const prev = state.manualSlides[id]?.imageUrl || null;
    const next = mergedManualSlides[id]?.imageUrl || null;
    if (next !== prev && next !== null) {
      changedUrl = next;
    }
  }

  // If no change detected, ensure all share the first non-null image
  if (changedUrl === null) {
    changedUrl = interstitialIds
      .map((id) => mergedManualSlides[id]?.imageUrl)
      .find((url) => url) || null;
  }

  if (changedUrl !== null) {
    for (const id of interstitialIds) {
      if (mergedManualSlides[id]) {
        mergedManualSlides[id].imageUrl = changedUrl;
      }
    }
  }
}

function normalizeOrganizerSequence(sequence = []) {
  const normalized = sequence.map((item, index) => {
    const phase = normalizePhase(item.phase ?? item.section);
    return {
      id: String(item.id || `item-${index + 1}`),
      type: normalizeType(item.type ?? item.kind),
      label: String(item.label || "Slide"),
      sourceStem: item.sourceStem ? String(item.sourceStem) : null,
      phase,
      backgroundTheme: normalizeBackgroundTheme(
        item.backgroundTheme ??
        item.backgroundType ??
        (item.presentation?.background === "dark" ? "dark" : item.presentation?.background === "light" ? "light" : item.presentation?.background),
        item.type ?? item.kind
      ),
      durationSec: Math.max(1, Math.min(3600, Number(item.durationSec) || 10))
    };
  });

  const seenIds = new Set();
  for (const item of normalized) {
    if (seenIds.has(item.id)) {
      throw new ValidationError(`Duplicate organizer item id "${item.id}".`);
    }
    seenIds.add(item.id);
  }

  return normalized;
}

// ── State cache ──────────────────────────────────────────────────────────────
// Cache serialized state snapshots to avoid redundant work.
let _stateSnapshotCache = null;
let _stateSnapshotCacheTime = 0;
const _STATE_CACHE_TTL_MS = 100; // 100ms - invalidate cache on rapid state changes

function invalidateStateCache() {
  _stateSnapshotCache = null;
  _stateSnapshotCacheTime = 0;
}

function getCachedStateSnapshot(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _stateSnapshotCache && now - _stateSnapshotCacheTime < _STATE_CACHE_TTL_MS) {
    return _stateSnapshotCache;
  }
  _stateSnapshotCache = getStateSnapshot();
  _stateSnapshotCacheTime = now;
  return _stateSnapshotCache;
}

// ── Session persistence helpers ───────────────────────────────────────────────

let _savePending = false;
let _saveTimer = null;
let _syncCurrentMassOnSave = false;

// ── Mass start-time automation ───────────────────────────────────────────────
let _startTimer = null;

// ── Pre-mass slideshow automation ────────────────────────────────────────────
let _preMassTimer = null;

// ── Gathering slideshow automation ───────────────────────────────────────────
let _gatheringTimer = null;

/**
 * Clear the pre-mass cycling timer and mark the slideshow as stopped.
 * Does NOT emit a state update — the caller is responsible for broadcasting.
 */
function stopPreMassTimer() {
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  state.preMassRunning = false;
}

/**
 * Schedule the next pre-mass slide advance.
 * Reads durationSec from the current slide's organizer item.
 * Loops through all pre-mass slides indefinitely; the start-time scheduler
 * (scheduleStartTimer) will stop it at mass time if massStartTime is set.
 */
function scheduleNextPreMassSlide(ioRef) {
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  if (!state.preMassRunning) return;

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "pre") {
    stopPreMassTimer();
    return;
  }

  // Let countdown slides control auto-advance and skip the phase timer.
  if (currentSlide.type === "countdown") { startCountdownForSlide(ioRef); return; }

  const orgItem = state.organizerSequence.find((item) => item.id === currentSlide.organizerItemId);
  const durationMs = Math.max(1000, (Number(orgItem?.durationSec) || 10) * 1000);

  _preMassTimer = setTimeout(() => {
    _preMassTimer = null;
    if (!state.preMassRunning) return;

    const allSlides = state.presentation?.slides || [];
    const preSlideIndices = allSlides.reduce((acc, s, i) => {
      if (s.phase === "pre") acc.push(i);
      return acc;
    }, []);

    if (preSlideIndices.length === 0) {
      stopPreMassTimer();
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      return;
    }

    const curPos = preSlideIndices.indexOf(state.currentSlideIndex);
    const nextPos = (curPos + 1) % preSlideIndices.length;
    state.currentSlideIndex = getSafeSlideIndex(preSlideIndices[nextPos]);
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextPreMassSlide(ioRef);
  }, durationMs);
}

/**
 * Clear the gathering timer and mark it as stopped.
 * Does NOT emit a state update — the caller is responsible for broadcasting.
 */
function stopGatheringTimer() {
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  state.gatheringRunning = false;
}

/**
 * Compute the total duration of all gathering slides in milliseconds.
 * Each organizer item with phase "gathering" contributes durationSec * slideCount,
 * where slideCount is how many presentation slides that item produced.
 */
function getGatheringDurationMs() {
  const slides = state.presentation?.slides || [];
  let totalMs = 0;
  for (const item of state.organizerSequence) {
    if (item.phase !== "gathering") continue;
    const slideCount = slides.filter((s) => s.organizerItemId === item.id).length;
    if (slideCount === 0) continue;
    totalMs += slideCount * Math.max(1000, (Number(item.durationSec) || 10) * 1000);
  }
  return totalMs;
}

/**
 * Start the gathering auto-advance sequence.
 * Stops pre-mass if running, jumps to first gathering slide (or first mass
 * slide if no gathering slides exist), and begins auto-advancing.
 */
function startGatheringSequence(ioRef) {
  stopPreMassTimer();
  stopGatheringTimer();
  stopPostMassTimer();

  const slides = state.presentation?.slides || [];
  const firstGatheringIdx = slides.findIndex((s) => s.phase === "gathering");
  const firstMassIdx = slides.findIndex((s) => s.phase === "mass");

  if (firstGatheringIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstGatheringIdx);
    state.gatheringRunning = true;
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextGatheringSlide(ioRef);
  } else if (firstMassIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstMassIdx);
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
  }
}

/**
 * Schedule the next gathering slide advance.
 * Unlike pre-mass, gathering does NOT loop — when the last gathering slide's
 * timer fires, it stops gathering and jumps to the first mass slide.
 */
function scheduleNextGatheringSlide(ioRef) {
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  if (!state.gatheringRunning) return;

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "gathering") {
    stopGatheringTimer();
    return;
  }

  // Let countdown slides control auto-advance and skip the phase timer.
  if (currentSlide.type === "countdown") { startCountdownForSlide(ioRef); return; }

  const orgItem = state.organizerSequence.find((item) => item.id === currentSlide.organizerItemId);
  const durationMs = Math.max(1000, (Number(orgItem?.durationSec) || 10) * 1000);

  _gatheringTimer = setTimeout(() => {
    _gatheringTimer = null;
    if (!state.gatheringRunning) return;

    const allSlides = state.presentation?.slides || [];
    const gatheringIndices = allSlides.reduce((acc, s, i) => {
      if (s.phase === "gathering") acc.push(i);
      return acc;
    }, []);

    const curPos = gatheringIndices.indexOf(state.currentSlideIndex);
    const isLast = curPos >= gatheringIndices.length - 1;

    if (isLast) {
      // Gathering is complete. Jump to the first mass slide.
      stopGatheringTimer();
      const firstMassIdx = allSlides.findIndex((s) => s.phase === "mass");
      if (firstMassIdx >= 0) {
        state.currentSlideIndex = getSafeSlideIndex(firstMassIdx);
      }
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      scheduleSave();
    } else {
      // Advance to the next gathering slide.
      state.currentSlideIndex = getSafeSlideIndex(gatheringIndices[curPos + 1]);
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      scheduleSave();
      scheduleNextGatheringSlide(ioRef);
    }
  }, durationMs);
}

// ── Post-mass slideshow automation ───────────────────────────────────────────
let _postMassTimer = null;

/**
 * Clear the post-mass cycling timer and mark the slideshow as stopped.
 */
function stopPostMassTimer() {
  if (_postMassTimer) { clearTimeout(_postMassTimer); _postMassTimer = null; }
  state.postMassRunning = false;
}

/**
 * Start the post-mass auto-advance loop.
 * Stops any running pre-mass or gathering timers, jumps to the first
 * post-mass slide, and loops through all post-mass slides indefinitely.
 */
function startPostMassSequence(ioRef) {
  stopPreMassTimer();
  stopGatheringTimer();
  stopPostMassTimer();

  const slides = state.presentation?.slides || [];
  const firstPostIdx = slides.findIndex((s) => s.phase === "post");

  if (firstPostIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstPostIdx);
    state.postMassRunning = true;
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextPostMassSlide(ioRef);
  }
}

/**
 * Schedule the next post-mass slide advance.
 * Loops through all post-mass slides indefinitely (like pre-mass).
 */
function scheduleNextPostMassSlide(ioRef) {
  if (_postMassTimer) { clearTimeout(_postMassTimer); _postMassTimer = null; }
  if (!state.postMassRunning) return;

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "post") {
    stopPostMassTimer();
    return;
  }

  // Let countdown slides control auto-advance and skip the phase timer.
  if (currentSlide.type === "countdown") { startCountdownForSlide(ioRef); return; }

  const orgItem = state.organizerSequence.find((item) => item.id === currentSlide.organizerItemId);
  const durationMs = Math.max(1000, (Number(orgItem?.durationSec) || 10) * 1000);

  _postMassTimer = setTimeout(() => {
    _postMassTimer = null;
    if (!state.postMassRunning) return;

    const allSlides = state.presentation?.slides || [];
    const postSlideIndices = allSlides.reduce((acc, s, i) => {
      if (s.phase === "post") acc.push(i);
      return acc;
    }, []);

    if (postSlideIndices.length === 0) {
      stopPostMassTimer();
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      return;
    }

    const curPos = postSlideIndices.indexOf(state.currentSlideIndex);
    const nextPos = (curPos + 1) % postSlideIndices.length;
    state.currentSlideIndex = getSafeSlideIndex(postSlideIndices[nextPos]);
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextPostMassSlide(ioRef);
  }, durationMs);
}

// ── Countdown automation ─────────────────────────────────────────────────────
let _countdownTimer = null;

function stopCountdownTimer() {
  if (_countdownTimer) { clearTimeout(_countdownTimer); _countdownTimer = null; }
  state.countdownEndsAt = null;
}

function clearInterstitialHoldState() {
  state.interstitialHoldActive = false;
  state.interstitialHoldSlideIndex = null;
  state.interstitialHoldReturnSlideIndex = null;
  state.interstitialHoldResumeState = null;
}

function resetDisplayOverrides() {
  state.isBlack = false;
  clearInterstitialHoldState();
}

function stopActiveSlideTimers() {
  stopPreMassTimer();
  stopGatheringTimer();
  stopPostMassTimer();
  stopCountdownTimer();
}

function findPreferredInterstitialSlideIndex(startIndex = state.currentSlideIndex) {
  const slides = state.presentation?.slides || [];
  if (!slides.length) return -1;

  const currentSlide = slides[getSafeSlideIndex(startIndex)];
  const currentPhase = currentSlide?.phase || null;

  const findClosestIn = (predicate) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    slides.forEach((slide, index) => {
      if (!predicate(slide, index)) return;
      const distance = Math.abs(index - startIndex);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  };

  const samePhaseIndex = findClosestIn((slide) => slide.type === "interstitial" && slide.phase === currentPhase);
  if (samePhaseIndex >= 0) return samePhaseIndex;

  const massIndex = findClosestIn((slide) => slide.type === "interstitial" && slide.phase === "mass");
  if (massIndex >= 0) return massIndex;

  return findClosestIn((slide) => slide.type === "interstitial");
}

function activateInterstitialHold() {
  if (state.interstitialHoldActive) return false;

  const holdIndex = findPreferredInterstitialSlideIndex(state.currentSlideIndex);
  if (holdIndex < 0) return false;

  state.interstitialHoldResumeState = {
    preMassRunning: Boolean(state.preMassRunning),
    gatheringRunning: Boolean(state.gatheringRunning),
    postMassRunning: Boolean(state.postMassRunning)
  };
  state.interstitialHoldReturnSlideIndex = state.currentSlideIndex;
  state.interstitialHoldSlideIndex = getSafeSlideIndex(holdIndex);
  state.interstitialHoldActive = true;
  state.isBlack = false;
  stopActiveSlideTimers();
  return true;
}

function stopAllRuntimeTimers() {
  if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  if (_postMassTimer) { clearTimeout(_postMassTimer); _postMassTimer = null; }
  if (_countdownTimer) { clearTimeout(_countdownTimer); _countdownTimer = null; }
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  state.preMassRunning = false;
  state.gatheringRunning = false;
  state.postMassRunning = false;
  state.countdownEndsAt = null;
  clearInterstitialHoldState();
}

/**
 * Start the countdown for the current slide if it is a countdown type.
 * Sets countdownEndsAt so clients can render the visual timer, and schedules
 * auto-advance when time expires.
 */
function startCountdownForSlide(ioRef) {
  stopCountdownTimer();
  const slides = state.presentation?.slides || [];
  const slide = slides[state.currentSlideIndex];
  if (!slide || slide.type !== "countdown") return;

  const durationMs = Math.max(1000, Math.min(300000, (Number(slide.countdownSec) || 60) * 1000));
  state.countdownEndsAt = Date.now() + durationMs;
  // Broadcast immediately so clients can start rendering the countdown.
  touch();
  ioRef.emit("state:update", getStateSnapshot());

  _countdownTimer = setTimeout(() => {
    _countdownTimer = null;
    state.countdownEndsAt = null;
    // Advance only when the current slide is not already the last slide.
    const allSlides = state.presentation?.slides || [];
    if (state.currentSlideIndex < allSlides.length - 1) {
      state.currentSlideIndex = getSafeSlideIndex(state.currentSlideIndex + 1);
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      scheduleSave();
      // Re-engage the active phase timer for the new slide.
      if (state.preMassRunning) scheduleNextPreMassSlide(ioRef);
      if (state.gatheringRunning) scheduleNextGatheringSlide(ioRef);
      if (state.postMassRunning) scheduleNextPostMassSlide(ioRef);
      // Start the next countdown when the next slide is also a countdown.
      const nextSlide = allSlides[state.currentSlideIndex];
      if (nextSlide?.type === "countdown") startCountdownForSlide(ioRef);
    } else {
      touch();
      ioRef.emit("state:update", getStateSnapshot());
    }
  }, durationMs);
}

/**
 * Schedule (or reschedule) the auto-advance to the first "mass" phase slide.
 * `io` is passed in because this runs in the server scope.
 * massStartTime must be a datetime-local string (YYYY-MM-DDTHH:MM).
 */
function scheduleStartTimer(ioRef) {
  if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
  const timeStr = state.massStartTime;
  if (!timeStr) return;
  const target = new Date(timeStr);
  if (isNaN(target.getTime())) return;

  // Fire early enough to play through all gathering slides before Mass starts.
  const gatheringMs = getGatheringDurationMs();
  const msUntilGathering = (target - Date.now()) - gatheringMs;
  if (msUntilGathering <= 0) return; // Already past

  _startTimer = setTimeout(() => {
    _startTimer = null;
    startGatheringSequence(ioRef);
  }, msUntilGathering);
}

/** Wait 600 ms after the last change before writing to disk. */
function scheduleSave(syncCurrentMass = false) {
  _syncCurrentMassOnSave = _syncCurrentMassOnSave || Boolean(syncCurrentMass);
  if (_savePending) return;
  _savePending = true;
  _saveTimer = setTimeout(() => {
    _savePending = false;
    _saveTimer = null;
    const shouldSyncCurrentMass = _syncCurrentMassOnSave;
    _syncCurrentMassOnSave = false;
    saveSession(state);
    if (shouldSyncCurrentMass) {
      saveCurrentMass();
    }
  }, 600);
}

/**
 * Attempt to restore the last saved session.
 * Re-imports readings from the saved folder path if it still exists on disk.
 */
function restoreSession() {
  const session = loadSession();
  if (!session) {
    logInfo(`[persistence] No saved session found at ${getSessionFilePath()}`);
    return;
  }

  logInfo(`[persistence] Restoring session saved at ${session.savedAt}`);

  const screenSettings = session.screenSettings || session.displaySettings;
  if (screenSettings && typeof screenSettings === "object") {
    state.screenSettings = normalizeScreenSettings(screenSettings);
  }

  if (session.massStartTime && typeof session.massStartTime === "string") {
    state.massStartTime = session.massStartTime;
  }

  if (session.startPinHash && typeof session.startPinHash === "object") {
    state.startPinHash = {
      hash: String(session.startPinHash.hash || ""),
      salt: String(session.startPinHash.salt || ""),
      iterations: Number(session.startPinHash.iterations) || PIN_HASH_ITERATIONS,
      digest: PIN_HASH_DIGEST
    };
    state.startPin = "";
  } else if (session.startPin && typeof session.startPin === "string") {
    // Migrate old plaintext PINs to hashed storage on restore.
    const cleaned = String(session.startPin).replace(/\D/g, "").slice(0, 6);
    if (cleaned.length >= 4) {
      state.startPinHash = createPinHashRecord(cleaned);
      state.startPin = "";
    }
  }

  const targetScreenIds = Array.isArray(session.targetScreenIds)
    ? [...new Set(session.targetScreenIds.map((id) => Number(id)).filter(Number.isFinite))]
    : [];
  const targetScreenId = session.targetScreenId ?? session.targetDisplayId;
  if (targetScreenIds.length > 0) {
    state.targetScreenIds = targetScreenIds;
    state.targetScreenId = targetScreenIds[0];
  } else if (targetScreenId != null) {
    state.targetScreenId = targetScreenId;
    state.targetScreenIds = [targetScreenId];
  }
  if (session.screenFullscreen || session.displayFullscreen) {
    state.screenFullscreen = true;
  }
  if (session.activeMassArchiveId && typeof session.activeMassArchiveId === "string") {
    state.activeMassArchiveId = session.activeMassArchiveId;
  }

  if (session.appSettings && typeof session.appSettings === "object") {
    if (!state.appSettings) state.appSettings = {};
    if (session.appSettings.theme && getTheme(session.appSettings.theme)) {
      state.appSettings.theme = session.appSettings.theme;
    }
  }

  if (Array.isArray(session.organizerSequence)) {
    state.organizerSequence = normalizeOrganizerSequence(session.organizerSequence);
  }

  if (session.manualSlides && typeof session.manualSlides === "object") {
    state.manualSlides = mergeManualSlideState(state.organizerSequence, session.manualSlides);
    propagateInterstitialImage(state.organizerSequence, state.manualSlides);
  }

  if (session.lastReadingsFolderPath) {
    // Prefer current_mass directory; fall back to saved path for backward compatibility
    const readingsPath = fs.existsSync(CURRENT_MASS_DIR) && fs.readdirSync(CURRENT_MASS_DIR).some((f) => f.endsWith(".txt"))
      ? CURRENT_MASS_DIR
      : session.lastReadingsFolderPath;
    try {
      const imported = importReadings(readingsPath, {
        fontSizePx: state.screenSettings.fontSizePx,
        fontFamily: state.screenSettings.fontFamily,
        readingTextHeightPx: state.screenSettings.readingTextHeightPx
      });
      state.readingsSource = {
        folderPath: readingsPath,
        documents: imported.documents || []
      };
      state.presentation = buildPresentationFromOrganizer({
        title: session.presentationTitle || imported.title || path.basename(session.lastReadingsFolderPath),
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });
      logInfo(`[persistence] Restored "${state.presentation.title}" with ${state.presentation.slides.length} slides`);
    } catch (err) {
      logWarn(`[persistence] Could not reload readings from "${session.lastReadingsFolderPath}": ${err.message}`);
    }
  }
}

// ── Express / Socket.IO server ────────────────────────────────────────────────

function startServer(port = 17841, options = {}) {
  // Defer session restore until after the server is listening.
  logger.setQuietLogs(options.quietLogs);

  function getLocalIpv4Address() {
    const interfaces = os.networkInterfaces();
    for (const addresses of Object.values(interfaces)) {
      if (!addresses) continue;
      for (const info of addresses) {
        if (info.family === "IPv4" && !info.internal) {
          return info.address;
        }
      }
    }
    return "localhost";
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*"
    }
  });

  const globalApiRateLimit = createRateLimitMiddleware({
    ...RATE_LIMIT_CONFIG.global,
    keyFn: getClientIp
  });
  const authRateLimit = createRateLimitMiddleware({
    ...RATE_LIMIT_CONFIG.auth,
    keyFn: getClientIp
  });
  const uploadRateLimit = createRateLimitMiddleware({
    ...RATE_LIMIT_CONFIG.upload,
    keyFn: getClientIp
  });
  const uploadConcurrentLimit = createConcurrentLimitMiddleware({
    bucket: RATE_LIMIT_CONFIG.upload.bucket,
    maxConcurrent: RATE_LIMIT_CONFIG.upload.maxConcurrent,
    label: `${RATE_LIMIT_CONFIG.upload.label}-concurrent`,
    keyFn: getClientIp
  });
  const heavyRateLimit = createRateLimitMiddleware({
    ...RATE_LIMIT_CONFIG.heavy,
    keyFn: getClientIp
  });
  const heavySocketRateLimit = createSocketRateLimitGuard({
    ...RATE_LIMIT_CONFIG.heavy,
    maxConcurrent: RATE_LIMIT_CONFIG.heavy.maxConcurrent
  });

  app.use(express.json({ limit: "200mb" }));
  app.use("/api", globalApiRateLimit);

  const publicDir = path.join(__dirname, "..", "public");
  app.use("/static", express.static(publicDir));

  app.get("/", (_, res) => {
    res.sendFile(path.join(publicDir, "app.html"));
  });

  app.get("/app", (_, res) => {
    res.sendFile(path.join(publicDir, "app.html"));
  });

  app.get("/screen", (_, res) => {
    res.sendFile(path.join(publicDir, "screen.html"));
  });

  app.get("/remote", (_, res) => {
    res.sendFile(path.join(publicDir, "remote.html"));
  });

  app.get("/start", (_, res) => {
    // Skip straight to start-redirect when no PIN is configured.
    if (!hasPinConfigured()) return res.redirect("/api/start-redirect");
    res.sendFile(path.join(publicDir, "start.html"));
  });

  app.get("/api/state", (_, res) => {
    res.json(getCachedStateSnapshot(true));
  });

  function handleMassAssetUpload(req, res) {
    try {
      fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
      const { filename, dataUrl } = req.body || {};
      if (!dataUrl) {
        return res.status(400).json({ error: "dataUrl is required." });
      }
      const match = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) {
        return res.status(400).json({ error: "Invalid image data URL." });
      }
      const ext = match[1].split("/")[1].replace("jpeg", "jpg").replace("+", "");
      // Build a readable, collision-safe filename from the original name.
      const baseName = String(filename || "light")
        .replace(/\.[^.]+$/, "")          // strip extension
        .replace(/[^a-zA-Z0-9_\-. ]/g, "")  // strip unsafe chars
        .replace(/\s+/g, "_")
        .slice(0, 60) || "light";
      const hex = crypto.randomBytes(4).toString("hex");
      const safeName = `${hex}-${baseName}.${ext}`;
      const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, safeName), Buffer.from(match[2], "base64"));
      return res.json({ ok: true, url: `/api/mass-asset/${safeName}` });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Upload failed." });
    }
  }

  // Save Mass-owned assets into current_mass/assets/ so they travel with the package.
  app.post("/api/upload-mass-asset", uploadRateLimit, uploadConcurrentLimit, handleMassAssetUpload);

  // Keep a backward-compatible alias for legacy callers.
  app.post("/api/upload-image", uploadRateLimit, uploadConcurrentLimit, handleMassAssetUpload);

  // List images in current_mass/assets/ for the asset picker.
  app.get("/api/mass-assets", (req, res) => {
    try {
      const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
      if (!fs.existsSync(assetsDir)) {
        return res.json({ assets: [] });
      }
      const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif"]);
      const files = fs.readdirSync(assetsDir)
        .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      const assets = files.map((f) => ({ name: f, url: `/api/mass-asset/${f}` }));
      return res.json({ assets });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to list assets." });
    }
  });

  // Serve mass assets from current_mass/assets/{filename}
  app.get("/api/mass-asset/:filename", (req, res) => {
    try {
      const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
      if (!fs.existsSync(assetsDir)) {
        return res.status(404).json({ error: "No Mass folder loaded." });
      }
      // Prevent path traversal: use only the basename, never sub-paths
      const filename = path.basename(req.params.filename);
      if (!/^[^/\\:*?"<>|]+\.[a-zA-Z0-9]+$/.test(filename)) {
        return res.status(400).json({ error: "Invalid filename." });
      }
      const filePath = path.join(assetsDir, filename);
      // Double-check resolved path is inside assetsDir
      if (!filePath.startsWith(assetsDir + path.sep) && filePath !== assetsDir) {
        return res.status(400).json({ error: "Invalid path." });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found." });
      }
      return res.sendFile(filePath, { dotfiles: "allow" });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to serve asset." });
    }
  });

  // List available prayers from the "prayers" folder
  app.get("/api/prayers", (req, res) => {
    try {
      const bundledPrayers = process.resourcesPath
        ? path.join(process.resourcesPath, "prayers")
        : null;
      const prayersDir = bundledPrayers && fs.existsSync(bundledPrayers)
        ? bundledPrayers
        : path.join(__dirname, "..", "prayers");
      if (!fs.existsSync(prayersDir)) {
        return res.json({ prayers: [] });
      }
      const files = fs.readdirSync(prayersDir)
        .filter((f) => f.toLowerCase().endsWith(".txt"))
        .sort();
      // Remove the .txt extension for display purposes, but keep the filename for loading
      const prayers = files.map((f) => ({
        filename: f,
        name: f.replace(/\.txt$/i, "")
      }));
      return res.json({ prayers });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to list prayers." });
    }
  });

  // Read the content of a specific prayer file.
  app.get("/api/prayers/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      if (!/\.txt$/i.test(filename)) {
        return res.status(400).json({ error: "Invalid prayer filename." });
      }
      const bundledPrayers = process.resourcesPath
        ? path.join(process.resourcesPath, "prayers")
        : null;
      const prayersDir = bundledPrayers && fs.existsSync(bundledPrayers)
        ? bundledPrayers
        : path.join(__dirname, "..", "prayers");
      const filePath = path.join(prayersDir, filename);
      // Double check path traversal
      if (!filePath.startsWith(prayersDir + path.sep) && filePath !== prayersDir) {
        return res.status(400).json({ error: "Invalid path." });
      }
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Prayer file not found." });
      }
      const content = fs.readFileSync(filePath, "utf8");
      return res.json({ content });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to get prayer content." });
    }
  });

  app.post("/api/screen-settings", (req, res) => {
    try {
      state.screenSettings = normalizeScreenSettings(req.body || {});
      repaginateReadingSlidesIfNeeded();
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true, screenSettings: state.screenSettings });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to update screen settings." });
    }
  });

  // ── App settings ───────────────────────────────────────────────────────────
  app.get("/api/themes", (_req, res) => {
    res.json({ themes: listThemes(), current: state.appSettings?.theme || DEFAULT_THEME });
  });

  app.get("/api/theme-vars", (_req, res) => {
    const out = {};
    for (const [id, t] of Object.entries(allThemes)) {
      out[id] = { label: t.label, vars: t.vars, colorScheme: t.colorScheme || "light" };
    }
    res.json({ themes: out, current: state.appSettings?.theme || DEFAULT_THEME });
  });

  app.post("/api/app-settings", (req, res) => {
    try {
      const { theme } = req.body || {};
      if (theme) {
        const t = getTheme(theme);
        if (t) {
          if (!state.appSettings) state.appSettings = {};
          state.appSettings.theme = theme;
        }
      }
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave();
      return res.json({ ok: true, appSettings: state.appSettings });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to update app settings." });
    }
  });

  app.post("/api/update-title", (req, res) => {
    try {
      const { title } = req.body || {};
      if (typeof title !== "string") {
        return res.status(400).json({ error: "title string is required." });
      }
      if (state.presentation) {
        state.presentation.title = title.trim();
      }
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to update title." });
    }
  });

  app.post("/api/start-time", (req, res) => {
    try {
      const { time } = req.body || {};
      if (time === null || time === undefined || time === "") {
        state.massStartTime = null;
        if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
      } else {
        const parsed = new Date(String(time));
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "time must be a valid datetime string (YYYY-MM-DDTHH:MM) or null to clear." });
        }
        state.massStartTime = String(time);
        scheduleStartTimer(io);
      }
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true, massStartTime: state.massStartTime });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to set start time." });
    }
  });

  // ── Start PIN management ───────────────────────────────────────────────────
  app.post("/api/start-pin", authRateLimit, (req, res) => {
    try {
      const { pin } = req.body || {};
      if (pin === null || pin === undefined || pin === "") {
        state.startPin = "";
        state.startPinHash = null;
      } else {
        const cleaned = String(pin).replace(/\D/g, "").slice(0, 6);
        if (cleaned.length < 4) {
          return res.status(400).json({ error: "PIN must be 4–6 digits." });
        }
        state.startPinHash = createPinHashRecord(cleaned);
        state.startPin = "";
      }
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true, hasPin: hasPinConfigured() });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to set PIN." });
    }
  });

  // ── PIN verification ───────────────────────────────────────────────────────
  app.post("/api/verify-pin", authRateLimit, (req, res) => {
    try {
      const ip = getClientIp(req);
      const activeLock = getActiveLock(ip);
      if (activeLock) {
        const retryAfterSec = Math.max(1, Math.ceil((activeLock.lockUntil - Date.now()) / 1000));
        res.set("Retry-After", String(retryAfterSec));
        return res.status(429).json({ error: "Too many failed attempts. Please try again later." });
      }

      const { pin } = req.body || {};
      if (!hasPinConfigured()) {
        // Allow access when no PIN is configured.
        return res.json({ ok: true, redirect: "/api/start-redirect" });
      }

      if (!verifyPin(pin)) {
        registerPinFailure(ip);
        return res.status(403).json({ error: "Incorrect PIN." });
      }

      clearPinFailures(ip);

      // Generate a one-time token for start-redirect.
      const token = issueStartToken({
        ip,
        userAgent: req.get("user-agent") || ""
      });
      return res.json({ ok: true, redirect: `/api/start-redirect?token=${token}` });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Verification failed." });
    }
  });

  app.post("/api/pre-mass/start", (req, res) => {
    try {
      const slides = state.presentation?.slides || [];
      const firstPreIdx = slides.findIndex((s) => s.phase === "pre");
      if (firstPreIdx < 0) {
        return res.status(400).json({ error: "No pre-mass slides found. Add slides with section 'Pre-Mass' first." });
      }
      stopGatheringTimer();
      stopPostMassTimer();
      state.currentSlideIndex = getSafeSlideIndex(firstPreIdx);
      state.preMassRunning = true;
      scheduleNextPreMassSlide(io);
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to start pre-mass." });
    }
  });

  app.post("/api/pre-mass/stop", (req, res) => {
    try {
      stopPreMassTimer();
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to stop pre-mass." });
    }
  });

  // Use /start for PIN auth before redirecting from QR-code entry when required.
  app.get("/api/start-redirect", authRateLimit, (req, res) => {
    try {
      // Send the request to the PIN page when no valid token is present.
      if (hasPinConfigured()) {
        const providedToken = String(req.query.token || "");
        const ip = getClientIp(req);
        const tokenValid = isStartTokenValid({
          token: providedToken,
          ip,
          userAgent: req.get("user-agent") || ""
        });

        if (!tokenValid) {
          return res.redirect("/start");
        }
      }

      // Clear the token after use.
      clearStartToken();

      const slides = state.presentation?.slides || [];
      const now = Date.now();
      const massTime = state.massStartTime ? new Date(state.massStartTime).getTime() : null;
      const isBeforeMass = !massTime || now < massTime;

      if (isBeforeMass) {
        // Before Mass start time, begin pre-mass announcements.
        const firstPreIdx = slides.findIndex((s) => s.phase === "pre");
        if (firstPreIdx >= 0 && !state.preMassRunning) {
          stopGatheringTimer();
          state.currentSlideIndex = getSafeSlideIndex(firstPreIdx);
          state.preMassRunning = true;
          scheduleNextPreMassSlide(io);
          touch();
          io.emit("state:update", getStateSnapshot());
          scheduleSave();
        }
      } else {
        // At or after Mass start time, jump to the first mass slide.
        stopPreMassTimer();
        stopGatheringTimer();
        const firstMassIdx = slides.findIndex((s) => s.phase === "mass");
        if (firstMassIdx >= 0) {
          state.currentSlideIndex = getSafeSlideIndex(firstMassIdx);
          touch();
          io.emit("state:update", getStateSnapshot());
          scheduleSave();
        }
      }
      return res.redirect("/remote");
    } catch (_error) {
      return res.redirect("/remote");
    }
  });

  app.post("/api/gathering/start", (req, res) => {
    try {
      const slides = state.presentation?.slides || [];
      const hasGatheringOrMass = slides.some((s) => s.phase === "gathering" || s.phase === "mass");
      if (!hasGatheringOrMass) {
        return res.status(400).json({ error: "No gathering or mass slides found." });
      }
      startGatheringSequence(io);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to start gathering." });
    }
  });

  app.post("/api/gathering/stop", (_, res) => {
    stopGatheringTimer();
    touch();
    io.emit("state:update", getStateSnapshot());
    scheduleSave();
    return res.json({ ok: true });
  });

  app.post("/api/post-mass/start", (_, res) => {
    try {
      const slides = state.presentation?.slides || [];
      const hasPost = slides.some((s) => s.phase === "post");
      if (!hasPost) {
        return res.status(400).json({ error: "No post-mass slides found." });
      }
      startPostMassSequence(io);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to start post-mass." });
    }
  });

  app.post("/api/post-mass/stop", (_, res) => {
    stopPostMassTimer();
    touch();
    io.emit("state:update", getStateSnapshot());
    scheduleSave();
    return res.json({ ok: true });
  });

  app.get("/api/export-settings", (_, res) => {
    try {
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        presentationTitle: state.presentation?.title || null,
        massStartTime: state.massStartTime || null,
        screenSettings: state.screenSettings,
        organizerSequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        lastReadingsFolderPath: state.readingsSource?.folderPath || null
      };
      const filename = `mass-settings-${new Date().toISOString().slice(0, 10)}.json`;
      setAttachmentFilename(res, filename);
      res.setHeader("Content-Type", "application/json");
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to export settings." });
    }
  });

  app.post("/api/import-settings", (req, res) => {
    try {
      const payload = req.body || {};
      if (payload.screenSettings && typeof payload.screenSettings === "object") {
        state.screenSettings = normalizeScreenSettings(payload.screenSettings);
      }
      if (Array.isArray(payload.organizerSequence)) {
        state.organizerSequence = normalizeOrganizerSequence(payload.organizerSequence);
      }
      if (payload.manualSlides && typeof payload.manualSlides === "object") {
        state.manualSlides = mergeManualSlideState(state.organizerSequence, payload.manualSlides);
        propagateInterstitialImage(state.organizerSequence, state.manualSlides);
      }
      repaginateReadingSlidesIfNeeded();
      if (payload.presentationTitle && state.presentation) {
        state.presentation.title = String(payload.presentationTitle);
      }
      if (payload.massStartTime && typeof payload.massStartTime === "string") {
        if (Number.isNaN(new Date(payload.massStartTime).getTime())) {
          throw new ValidationError("massStartTime must be a valid datetime string.");
        }
        state.massStartTime = payload.massStartTime;
        scheduleStartTimer(io);
      } else if (payload.massStartTime === null) {
        state.massStartTime = null;
        if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
      }
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true });
    } catch (error) {
      return sendApiError(res, error, "Failed to import settings.");
    }
  });

  // ── Mass package ZIP export ────────────────────────────────────────────────
  app.get("/api/export-mass-zip", heavyRateLimit, async (_, res) => {
    try {
      saveCurrentMass();
      if (!fs.existsSync(path.join(CURRENT_MASS_DIR, "mass.json"))) {
        return res.status(400).json({ error: "No current Mass package to export." });
      }
      const zipBuffer = await buildMassZipFromPackage(CURRENT_MASS_DIR);
      const filename = buildExportFilename(state.presentation?.title, state.massStartTime, ".zip");

      setAttachmentFilename(res, filename);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Length", zipBuffer.length);
      return res.end(zipBuffer);
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to export ZIP." });
    }
  });

  // ── Export Mass ZIP (AVIF-compressed, graphics only) ──────────────────────
  // The AVIF export is driven via Socket.IO so the client gets per-image
  // progress updates.  When complete the client downloads from a one-time token.
  const avifDownloadTokens = new Map(); // token → { zipBuffer, filename }

  app.get("/api/export-mass-zip-avif", heavyRateLimit, (req, res) => {
    const token = req.query.token;
    const entry = token && avifDownloadTokens.get(token);
    if (!entry) return res.status(404).json({ error: "Invalid or expired download token." });
    avifDownloadTokens.delete(token);
    setAttachmentFilename(res, entry.filename);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", entry.zipBuffer.length);
    return res.end(entry.zipBuffer);
  });

  // ── Duplicate Mass ─────────────────────────────────────────────────────────
  app.post("/api/duplicate-mass", (req, res) => {
    try {
      const { title, startTime } = req.body || {};
      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: "title is required." });
      }

      const hasArchivableContent = state.organizerSequence.length > 0 ||
        (state.presentation?.title && state.presentation.title !== "No presentation loaded");
      let archivedMassId = null;
      if (hasArchivableContent) {
        saveCurrentMass();
        archivedMassId = state.activeMassArchiveId || null;
      }

      // 2. Apply new title
      state.activeMassArchiveId = null;
      state.presentation.title = String(title).trim();

      // 3. Apply new start time (or clear it)
      if (startTime) {
        const parsed = new Date(String(startTime));
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "startTime must be a valid datetime (YYYY-MM-DDTHH:MM) or empty." });
        }
        state.massStartTime = String(startTime);
        scheduleStartTimer(io);
      } else {
        state.massStartTime = null;
        if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
      }

      // 4. Reset playback state
      state.currentSlideIndex = 0;
      resetDisplayOverrides();
      state.preMassRunning = false;
      stopGatheringTimer();

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({
        ok: true,
        archivedMassId,
        title: state.presentation.title,
        massStartTime: state.massStartTime
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to duplicate mass." });
    }
  });

  // ── New Mass ───────────────────────────────────────────────────────────────
  app.post("/api/new-mass", (req, res) => {
    try {
      const { title, startTime } = req.body || {};
      if (!title || !String(title).trim()) {
        return res.status(400).json({ error: "title is required." });
      }

      // 1. Archive current mass if it has content
      let archivedMassId = null;
      const hasContent = state.organizerSequence.length > 0 ||
        (state.presentation?.title && state.presentation.title !== "No presentation loaded");
      if (hasContent) {
        saveCurrentMass();
        archivedMassId = state.activeMassArchiveId || null;
      }

      // 2. Build a default organizer sequence with placeholder slides
      state.activeMassArchiveId = null;
    const newSequence = [
      { id: "pre-announcements", type: "text", label: "Sacra Lux", phase: "pre", backgroundTheme: "dark", durationSec: 30 },
      { id: "gathering-countdown", type: "countdown", label: "30-Second Timer", phase: "gathering", backgroundTheme: "dark", durationSec: 30 },
      { id: "mass-title", type: "text", label: "Mass Title", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-opening-hymn", type: "hymn", label: "Opening Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-1", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-gloria", type: "hymn", label: "Gloria", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-2", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-reading-1", type: "reading", label: "First Reading", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-3", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-psalm", type: "reading", label: "Psalm", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-4", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-reading-2", type: "reading", label: "Second Reading", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-5", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-gospel-acclamation", type: "hymn", label: "Gospel Acclamation", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-6", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-gospel", type: "reading", label: "Gospel", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-7", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-nicene-creed", type: "prayer", label: "Nicene Creed", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-8", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-offertory", type: "hymn", label: "Offertory Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-9", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-lords-prayer", type: "prayer", label: "The Lord's Prayer", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-10", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-communion", type: "hymn", label: "Communion Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-11", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-recessional", type: "hymn", label: "Recessional Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "mass-interstitial-12", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
      { id: "post-announcements", type: "text", label: "Sacra Lux", phase: "post", backgroundTheme: "dark", durationSec: 30 }
    ];

      state.organizerSequence = normalizeOrganizerSequence(newSequence);
      const newManualSlides = {};
      for (const item of state.organizerSequence) {
        if (item.type === "text" || item.type === "prayer" || item.type === "hymn") {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: "middle", imageUrl: null };
        } else if (item.type === "countdown") {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: null, imageUrl: null, countdownSec: 60, countdownFont: "", countdownShowLabel: true };
        } else {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: null, imageUrl: null };
        }
      }
      state.manualSlides = newManualSlides;

      // 3. Set title and start time
      state.presentation.title = String(title).trim();
      state.presentation.sourceFile = null;
      if (startTime) {
        const parsed = new Date(String(startTime));
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "startTime must be a valid datetime (YYYY-MM-DDTHH:MM) or empty." });
        }
        state.massStartTime = String(startTime);
        scheduleStartTimer(io);
      } else {
        state.massStartTime = null;
        if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
      }

      // 4. Clear readings and reset playback
      state.readingsSource = { folderPath: null, documents: [] };
      state.currentSlideIndex = 0;
      resetDisplayOverrides();
      state.preMassRunning = false;
      stopGatheringTimer();

      // 5. Build presentation from new sequence
      state.presentation = buildPresentationFromOrganizer({
        title: state.presentation.title,
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({
        ok: true,
        archivedMassId,
        title: state.presentation.title,
        massStartTime: state.massStartTime,
        organizerCount: state.organizerSequence.length,
        slideCount: state.presentation.slides.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to create new mass." });
    }
  });

  // ── Mass package ZIP import ────────────────────────────────────────────────
  app.post("/api/import-mass-zip", heavyRateLimit, (req, res) => {
    try {
      const { zipData } = req.body || {};
      if (!zipData) {
        return res.status(400).json({ error: "zipData is required." });
      }
      // Accept base64 data URL (data:application/zip;base64,...) or plain base64
      const match = String(zipData).match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
      if (!match) {
        return res.status(400).json({ error: "Invalid zip data." });
      }
      const zipBuf = Buffer.from(match[1].replace(/\s/g, ""), "base64");
      const zip = new (getAdmZip())(zipBuf);

      const massEntry = zip.getEntry("mass.json");
      const settingsEntry = zip.getEntry("settings.json");
      const definitionEntry = massEntry || settingsEntry;
      if (!definitionEntry) {
        return res.status(400).json({ error: "ZIP does not contain mass.json or settings.json." });
      }
      const packageDefinition = JSON.parse(definitionEntry.getData().toString("utf8"));

      // Extract readings/ to ~/.sacra-lux/current_mass/
      // Clear current_mass first so it reflects this import
      if (fs.existsSync(CURRENT_MASS_DIR)) {
        fs.rmSync(CURRENT_MASS_DIR, { recursive: true, force: true });
      }
      fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
      const readingsEntries = zip.getEntries().filter(
        (e) => e.entryName.startsWith("readings/") && !e.entryName.startsWith("readings/assets/") && !e.isDirectory
      );
      if (readingsEntries.length > 0) {
        for (const entry of readingsEntries) {
          const filename = getSafeZipEntryFilename(entry.entryName, "readings/", /^[^/\\:*?"<>|]+\.txt$/);
          if (!filename) continue;
          fs.writeFileSync(path.join(CURRENT_MASS_DIR, filename), entry.getData());
        }
      }
      // Extract readings/assets/ — images co-located with the Mass
      const assetEntries = zip.getEntries().filter(
        (e) => e.entryName.startsWith("readings/assets/") && !e.isDirectory
      );
      if (assetEntries.length > 0) {
        const assetsImportDir = path.join(CURRENT_MASS_DIR, "assets");
        fs.mkdirSync(assetsImportDir, { recursive: true });
        for (const entry of assetEntries) {
          const filename = getSafeZipEntryFilename(
            entry.entryName,
            "readings/assets/",
            /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
          );
          if (!filename) continue;
          fs.writeFileSync(path.join(assetsImportDir, filename), entry.getData());
        }
      }

      const v3AssetEntries = zip.getEntries().filter((e) => e.entryName.startsWith("assets/") && !e.isDirectory);
      if (v3AssetEntries.length > 0) {
        const assetsImportDir = path.join(CURRENT_MASS_DIR, "assets");
        fs.mkdirSync(assetsImportDir, { recursive: true });
        for (const entry of v3AssetEntries) {
          const filename = getSafeZipEntryFilename(
            entry.entryName,
            "assets/",
            /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
          );
          if (!filename) continue;
          fs.writeFileSync(path.join(assetsImportDir, filename), entry.getData());
        }
      }

      // Extract legacy uploads/ entries into current_mass/assets/
      const uploadEntries = zip.getEntries().filter((e) => e.entryName.startsWith("uploads/") && !e.isDirectory);
      if (uploadEntries.length > 0) {
        const assetsImportDir = path.join(CURRENT_MASS_DIR, "assets");
        fs.mkdirSync(assetsImportDir, { recursive: true });
        for (const entry of uploadEntries) {
          const filename = getSafeZipEntryFilename(
            entry.entryName,
            "uploads/",
            /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
          );
          if (!filename) continue;
          const dest = path.join(assetsImportDir, filename);
          if (!fs.existsSync(dest)) {
            fs.writeFileSync(dest, entry.getData());
          }
        }
      }

      state.activeMassArchiveId = null;
      applyMassPackageFromCurrentDir(io, packageDefinition);
      scheduleSave(true);
      return res.json({ ok: true, slideCount: state.presentation.slides.length });
    } catch (error) {
      return sendApiError(res, error, "Failed to import ZIP.");
    }
  });

  app.get("/api/mass-history", (_req, res) => {
    try {
      return res.json({
        ok: true,
        activeArchiveId: state.activeMassArchiveId || null,
        archives: listMassArchives(state.activeMassArchiveId || null)
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to list Mass history." });
    }
  });

  app.post("/api/mass-history/:archiveId/load", async (req, res) => {
    try {
      const archiveId = path.basename(String(req.params.archiveId || ""));
      const archivePaths = getArchivePaths(archiveId);
      if (!fs.existsSync(archivePaths.archiveDir)) {
        return res.status(404).json({ error: "Mass archive not found." });
      }

      if (fs.existsSync(CURRENT_MASS_DIR)) {
        fs.rmSync(CURRENT_MASS_DIR, { recursive: true, force: true });
      }

      if (fs.existsSync(archivePaths.packageDir)) {
        fs.cpSync(archivePaths.packageDir, CURRENT_MASS_DIR, { recursive: true });
        const massJsonPath = path.join(CURRENT_MASS_DIR, "mass.json");
        if (!fs.existsSync(massJsonPath)) {
          return res.status(400).json({ error: "Archive package is missing mass.json." });
        }
        const packageData = JSON.parse(fs.readFileSync(massJsonPath, "utf8"));
        state.activeMassArchiveId = archiveId;
        applyMassPackageFromCurrentDir(io, packageData);
      } else if (fs.existsSync(archivePaths.compressedZipPath)) {
        const zipBuffer = fs.readFileSync(archivePaths.compressedZipPath);
        const zip = new (getAdmZip())(zipBuffer);
        const massEntry = zip.getEntry("mass.json");
        const settingsEntry = zip.getEntry("settings.json");
        const definitionEntry = massEntry || settingsEntry;
        if (!definitionEntry) {
          return res.status(400).json({ error: "Compressed archive is missing mass.json or settings.json." });
        }
        const packageDefinition = JSON.parse(definitionEntry.getData().toString("utf8"));
        fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          if (entry.entryName === "settings.json" || entry.entryName === "mass.json") continue;
          if (entry.entryName.startsWith("assets/")) {
            const filename = getSafeZipEntryFilename(
              entry.entryName,
              "assets/",
              /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
            );
            if (!filename) continue;
            const assetDir = path.join(CURRENT_MASS_DIR, "assets");
            fs.mkdirSync(assetDir, { recursive: true });
            fs.writeFileSync(path.join(assetDir, filename), entry.getData());
            continue;
          }
          if (entry.entryName.startsWith("readings/assets/")) {
            const filename = getSafeZipEntryFilename(
              entry.entryName,
              "readings/assets/",
              /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
            );
            if (!filename) continue;
            const assetDir = path.join(CURRENT_MASS_DIR, "assets");
            fs.mkdirSync(assetDir, { recursive: true });
            fs.writeFileSync(path.join(assetDir, filename), entry.getData());
            continue;
          }
          if (entry.entryName.startsWith("readings/")) {
            const filename = getSafeZipEntryFilename(entry.entryName, "readings/", /^[^/\\:*?"<>|]+\.txt$/);
            if (!filename) continue;
            fs.writeFileSync(path.join(CURRENT_MASS_DIR, filename), entry.getData());
            continue;
          }
          if (entry.entryName.startsWith("uploads/")) {
            const filename = getSafeZipEntryFilename(
              entry.entryName,
              "uploads/",
              /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif)$/i
            );
            if (!filename) continue;
            const assetDir = path.join(CURRENT_MASS_DIR, "assets");
            fs.mkdirSync(assetDir, { recursive: true });
            fs.writeFileSync(path.join(assetDir, filename), entry.getData());
          }
        }
        state.activeMassArchiveId = archiveId;
        applyMassPackageFromCurrentDir(io, packageDefinition);
      } else {
        return res.status(400).json({ error: "Mass archive has no loadable package." });
      }

      scheduleSave(true);
      return res.json({ ok: true, activeArchiveId: archiveId, title: state.presentation?.title || null });
    } catch (error) {
      return sendApiError(res, error, "Failed to load Mass archive.");
    }
  });

  app.post("/api/mass-history/:archiveId/compress", heavyRateLimit, async (req, res) => {
    try {
      const archiveId = path.basename(String(req.params.archiveId || ""));
      if (archiveId === state.activeMassArchiveId) {
        return res.status(400).json({ error: "The active Mass cannot be compressed." });
      }
      const archivePaths = getArchivePaths(archiveId);
      if (!fs.existsSync(archivePaths.packageDir)) {
        return res.status(400).json({ error: "Mass archive is already compressed or missing its package." });
      }
      const zipBuffer = await buildMassZipFromPackage(archivePaths.packageDir, { avif: true });
      fs.writeFileSync(archivePaths.compressedZipPath, zipBuffer);
      fs.rmSync(archivePaths.packageDir, { recursive: true, force: true });
      const metadata = {
        ...(readMetadata(archiveId) || {}),
        id: archiveId,
        storage: "compressed",
        updatedAt: new Date().toISOString(),
        compressedAt: new Date().toISOString()
      };
      writeMetadata(archiveId, metadata);
      return res.json({ ok: true, archiveId, sizeBytes: zipBuffer.length });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to compress Mass archive." });
    }
  });

  app.delete("/api/mass-history/:archiveId", (req, res) => {
    try {
      const archiveId = path.basename(String(req.params.archiveId || ""));
      if (archiveId === state.activeMassArchiveId) {
        return res.status(400).json({ error: "The active Mass archive cannot be deleted." });
      }
      const deleted = deleteMassArchive(archiveId);
      if (!deleted) {
        return res.status(404).json({ error: "Mass archive not found." });
      }
      return res.json({ ok: true, archiveId });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to delete Mass archive." });
    }
  });

  app.post("/api/organizer", (req, res) => {
    try {
      const { sequence, manualSlides } = req.body || {};
      if (!Array.isArray(sequence)) {
        return res.status(400).json({ error: "sequence array is required." });
      }

      state.organizerSequence = normalizeOrganizerSequence(sequence);
      state.manualSlides = mergeManualSlideState(state.organizerSequence, manualSlides || {});
      propagateInterstitialImage(state.organizerSequence, state.manualSlides);
      // Always rebuild the presentation so manual content stays current.
      state.presentation = buildPresentationFromOrganizer({
        title: state.presentation.title,
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });
      state.currentSlideIndex = getSafeSlideIndex(state.currentSlideIndex);
      // Reschedule the Mass start timer because gathering durations may have changed.
      scheduleStartTimer(io);
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({
        ok: true,
        organizerCount: state.organizerSequence.length,
        slideCount: state.presentation.slides.length
      });
    } catch (error) {
      return sendApiError(res, error, "Failed to update organizer.");
    }
  });

  app.post("/api/load-readings", (req, res) => {
    try {
      const { folderPath, insertAtIndex, screenSettings } = req.body || {};
      if (!folderPath) {
        return res.status(400).json({ error: "folderPath is required." });
      }

      if (screenSettings && typeof screenSettings === "object") {
        state.screenSettings = normalizeScreenSettings(screenSettings);
      }

      // Copy readings into the standard current_mass directory.
      const currentMassPath = copyReadingsToCurrentMass(folderPath);

      const imported = importReadings(currentMassPath, {
        fontSizePx: state.screenSettings.fontSizePx,
        fontFamily: state.screenSettings.fontFamily,
        readingTextHeightPx: state.screenSettings.readingTextHeightPx
      });

      state.readingsSource = {
        folderPath: currentMassPath,
        documents: imported.documents || []
      };

      const defaults = createDefaultOrganizer(state.readingsSource.documents);

      if (state.organizerSequence.length === 0 || insertAtIndex === undefined) {
        state.organizerSequence = defaults.sequence;
        state.manualSlides = defaults.manualSlides;
      } else {
        const targetSlide = state.presentation.slides[Math.min(insertAtIndex, state.presentation.slides.length - 1)];
        const organizerIndex = state.organizerSequence.findIndex(
          (item) => item.id === targetSlide?.organizerItemId
        );
        const insertOrganizerAt = organizerIndex >= 0 ? organizerIndex + 1 : state.organizerSequence.length;
        state.organizerSequence.splice(insertOrganizerAt, 0, ...defaults.sequence);
        state.manualSlides = {
          ...state.manualSlides,
          ...defaults.manualSlides
        };
      }

      state.presentation = buildPresentationFromOrganizer({
        title: imported.title || path.basename(folderPath),
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({
        ok: true,
        injectedSlides: imported.slides.length,
        totalSlides: state.presentation.slides.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to load readings." });
    }
  });

  app.post("/api/reload-mass-folder", (req, res) => {
    try {
      if (!fs.existsSync(CURRENT_MASS_DIR)) {
        return res.status(400).json({ error: "No current mass folder found." });
      }

      const imported = importReadings(CURRENT_MASS_DIR, {
        fontSizePx: state.screenSettings.fontSizePx,
        fontFamily: state.screenSettings.fontFamily,
        readingTextHeightPx: state.screenSettings.readingTextHeightPx
      });

      state.readingsSource = {
        folderPath: CURRENT_MASS_DIR,
        documents: imported.documents || []
      };

      state.presentation = buildPresentationFromOrganizer({
        title: state.presentation?.title || imported.title || "Mass Presentation",
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });

      state.currentSlideIndex = getSafeSlideIndex(state.currentSlideIndex);
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({
        ok: true,
        totalSlides: state.presentation.slides.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to reload mass folder." });
    }
  });

  app.post("/api/preview-reading", (req, res) => {
    try {
      const { text, stem, label, overrideSettings } = req.body || {};

      const doc = state.readingsSource?.documents?.find((d) => d.stem === stem);
      if (!doc) {
        return res.status(404).json({ error: "Reading not found in loaded documents." });
      }

      const dummyDoc = {
        stem: doc.stem,
        section: doc.section,
        passage: doc.passage,
        textLines: (text || "").split(/\r?\n/),
        ending: doc.ending
      };

      const settings = {
        ...state.screenSettings,
        ...(overrideSettings || {})
      };

      const slides = paginateDocuments([dummyDoc], {
        fontSizePx: settings.fontSizePx,
        fontFamily: settings.fontFamily,
        readingTextHeightPx: settings.readingTextHeightPx,
        readingLineHeight: settings.readingLineHeight,
        readingTextMarginXPx: settings.readingTextMarginXPx,
        readingTextSizePx: settings.readingTextSizePx
      }).map((slide) => ({
        ...slide,
        groupLabel: String(label || doc.section || "")
      }));

      return res.json({ ok: true, slides });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to preview reading." });
    }
  });

  app.post("/api/preview-manual-slide", (req, res) => {
    try {
      const payload = req.body || {};
      const type = normalizeType(payload.type);
      if (type === "reading") {
        return res.status(400).json({ error: "Use /api/preview-reading for reading slides." });
      }

      const organizerId = "preview:manual";
      const sequence = [{
        id: organizerId,
        type,
        sourceStem: null,
        label: String(payload.label || "Slide"),
        phase: normalizePhase(payload.phase),
        backgroundTheme: normalizeBackgroundTheme(payload.backgroundTheme, type)
      }];

      const incomingManual = payload.manualSlide && typeof payload.manualSlide === "object"
        ? payload.manualSlide
        : {};
      const manual = createManualSlideRecord(type);
      manual.text = String(incomingManual.text || "");
      manual.notes = String(incomingManual.notes || "");
      manual.imageUrl = String(incomingManual.imageUrl || "").trim() || null;
      if (["top", "middle", "bottom"].includes(String(incomingManual.textVAlign || ""))) {
        manual.textVAlign = String(incomingManual.textVAlign);
      }
      if (type === "countdown") {
        manual.countdownSec = Math.max(1, Math.min(300, Number(incomingManual.countdownSec) || 60));
        manual.countdownFont = String(incomingManual.countdownFont || "");
        manual.countdownShowLabel = incomingManual.countdownShowLabel !== false;
      }

      const presentation = buildPresentationFromOrganizer({
        title: "Preview",
        documents: state.readingsSource?.documents || [],
        sequence,
        manualSlides: { [organizerId]: manual },
        screenSettings: state.screenSettings
      });

      return res.json({ ok: true, slides: presentation.slides || [] });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to preview slide." });
    }
  });

  app.post("/api/save-reading", (req, res) => {
    try {
      const { stem, text } = req.body || {};
      const folderPath = state.readingsSource?.folderPath;
      if (!folderPath || !stem) {
        return res.status(400).json({ error: "No Mass readings folder loaded or stem missing." });
      }

      const filePath = path.join(folderPath, `${stem}.txt`);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File not found: ${filePath}` });
      }

      const fileContent = fs.readFileSync(filePath, "utf8");
      const lines = fileContent.split(/\r?\n/);
      let textStart = 1;
      while (textStart < lines.length && lines[textStart].trim() === "") {
        textStart++;
      }

      const headerLines = lines.slice(0, textStart);
      const newContent = headerLines.join("\n") + "\n" + text;

      fs.writeFileSync(filePath, newContent);

      const imported = importReadings(folderPath, {
        fontSizePx: state.screenSettings.fontSizePx,
        fontFamily: state.screenSettings.fontFamily,
        readingTextHeightPx: state.screenSettings.readingTextHeightPx
      });

      state.readingsSource = {
        folderPath: imported.folderPath,
        documents: imported.documents || []
      };

      state.presentation = buildPresentationFromOrganizer({
        title: imported.title || path.basename(folderPath),
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave();

      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to save reading." });
    }
  });

  // ── Session info ───────────────────────────────────────────────────────────
  app.get("/api/session-info", (_, res) => {
    res.json({
      lastReadingsFolderPath: state.readingsSource?.folderPath || null,
      sessionFile: getSessionFilePath()
    });
  });

  // ── Server info ────────────────────────────────────────────────────────────
  // Populate serverInfo once the HTTP server is bound.
  const serverInfo = { host: "localhost", port: 17841 };
  app.get("/api/server-info", (_, res) => {
    const { host, port: p } = serverInfo;
    res.json({
      host,
      port: p,
      remoteUrl: `http://${host}:${p}/remote`,
      screenUrl: `http://${host}:${p}/screen`,
      appUrl: `http://${host}:${p}/`
    });
  });

  function broadcast() {
    touch();
    invalidateStateCache();
    io.emit("state:update", getCachedStateSnapshot());
    scheduleSave();
  }

  function releaseInterstitialHold(returnSlideIndexOverride = null) {
    if (!state.interstitialHoldActive) return false;

    const hasExplicitReturnIndex = Number.isFinite(Number(returnSlideIndexOverride));
    const returnIndex = getSafeSlideIndex(
      hasExplicitReturnIndex
        ? Number(returnSlideIndexOverride)
        : Number.isFinite(Number(state.interstitialHoldReturnSlideIndex))
        ? Number(state.interstitialHoldReturnSlideIndex)
        : state.currentSlideIndex
    );
    const resumeState = state.interstitialHoldResumeState || {};

    clearInterstitialHoldState();
    state.preMassRunning = Boolean(resumeState.preMassRunning);
    state.gatheringRunning = Boolean(resumeState.gatheringRunning);
    state.postMassRunning = Boolean(resumeState.postMassRunning);
    setSlide(returnIndex);
    return true;
  }

  function toggleInterstitialHold(returnSlideIndexOverride = null) {
    if (state.interstitialHoldActive) {
      return releaseInterstitialHold(returnSlideIndexOverride);
    }
    const activated = activateInterstitialHold();
    if (activated) {
      broadcast();
    }
    return activated;
  }

  function setSlide(index, options = {}) {
    const {
      activateGatheringSequence = false,
      activatePostMassLoop = false
    } = options;
    state.currentSlideIndex = getSafeSlideIndex(index);
    const slide = (state.presentation?.slides || [])[state.currentSlideIndex];
    if (activateGatheringSequence && slide?.phase === "gathering") {
      stopPreMassTimer();
      stopGatheringTimer();
      stopPostMassTimer();
      state.gatheringRunning = true;
    }
    if (activatePostMassLoop && slide?.phase === "post") {
      stopPreMassTimer();
      stopGatheringTimer();
      stopPostMassTimer();
      state.postMassRunning = true;
    }
    // If pre-mass is running, reset the timer or stop it when the slide leaves that phase.
    if (state.preMassRunning) {
      if (slide?.phase === "pre") {
        scheduleNextPreMassSlide(io);
      } else {
        stopPreMassTimer();
      }
    }
    // If gathering is running, reschedule it or stop it when the slide leaves that phase.
    if (state.gatheringRunning) {
      if (slide?.phase === "gathering") {
        scheduleNextGatheringSlide(io);
      } else {
        stopGatheringTimer();
      }
    }
    // If post-mass is running, reschedule it or stop it when the slide leaves that phase.
    if (state.postMassRunning) {
      if (slide?.phase === "post") {
        scheduleNextPostMassSlide(io);
      } else {
        stopPostMassTimer();
      }
    }
    // Start or stop the countdown timer based on the current slide type.
    if (slide?.type === "countdown") {
      startCountdownForSlide(io);
    } else {
      stopCountdownTimer();
    }
    broadcast();
  }

  function stepSlide(step) {
    const nextIndex = state.currentSlideIndex + step;
    setSlide(nextIndex);
  }

  // Initialize session restore and timers only after the HTTP server starts listening.

  io.on("connection", (socket) => {
    socket.emit("state:update", getCachedStateSnapshot(true));

    socket.on("screen:settings", (settings) => {
      state.screenSettings = normalizeScreenSettings(settings || {});
      repaginateReadingSlidesIfNeeded();
      broadcast();
    });

    socket.on("slide:next", () => stepSlide(1));
    socket.on("slide:prev", () => stepSlide(-1));
    socket.on("slide:goto", (index) => setSlide(Number(index) || 0));
    socket.on("slide:goto:remote", (index) => setSlide(Number(index) || 0, {
      activateGatheringSequence: true,
      activatePostMassLoop: true
    }));
    socket.on("screen:interstitial-hold", (payload) => {
      if (!toggleInterstitialHold(payload?.returnSlideIndex)) {
        socket.emit("interstitial:hold:error", { error: "No interstitial slide is available." });
      }
    });

    socket.on("screen:black", (isBlack) => {
      state.isBlack = Boolean(isBlack);
      broadcast();
    });

    socket.on("export:avif:start", async () => {
      const limitState = heavySocketRateLimit(socket);
      if (!limitState.allowed) {
        socket.emit("export:avif:error", { error: `Too many requests. Retry after ${limitState.retryAfterSec}s.` });
        return;
      }

      try {
        saveCurrentMass();
        const sharp = require("sharp");
        const zip = new (getAdmZip())();

        // Collect image URLs referenced by manual slides and screen settings.
        const imageRefs = [];
        for (const [id, slide] of Object.entries(state.manualSlides || {})) {
          if (slide.imageUrl) {
            imageRefs.push({ url: slide.imageUrl, type: "slide", id });
          }
        }
        for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
          const url = state.screenSettings?.[key];
          if (url) imageRefs.push({ url, type: "screenSetting", key });
        }

        // Resolve image URLs to filesystem paths and skip built-ins or missing files.
        const CONVERTIBLE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif"]);
        const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
        const resolved = [];
        for (const ref of imageRefs) {
          const url = ref.url;
          let filePath = null;
          let originalName = null;

          const assetMatch = url.match(/\/api\/mass-asset\/([^/]+)$/);
          if (assetMatch) {
            originalName = assetMatch[1];
            filePath = path.join(assetsDir, originalName);
          }
          if (url.startsWith("/static/assets/")) continue;
          if (!filePath || !originalName || !fs.existsSync(filePath)) continue;
          resolved.push({ url, filePath, originalName });
        }

        const total = resolved.length;
        const urlRemap = new Map();

        for (let i = 0; i < resolved.length; i++) {
          const { url, filePath, originalName } = resolved[i];
          const ext = path.extname(originalName).toLowerCase();

          socket.emit("export:avif:progress", {
            current: i + 1,
            total,
            filename: originalName
          });

          if (CONVERTIBLE_EXT.has(ext)) {
            const baseName = path.basename(originalName, ext);
            const avifName = `${baseName}.avif`;
            const avifBuffer = await sharp(filePath).avif({ quality: 50 }).toBuffer();
            zip.addFile(`assets/${avifName}`, avifBuffer);
            urlRemap.set(url, `assets/${avifName}`);
          } else {
            zip.addFile(`assets/${originalName}`, fs.readFileSync(filePath));
          }
        }

        const massDocument = buildMassDocumentFromState(state);
        for (const item of massDocument.items || []) {
          if (item.asset?.ref) {
            const url = `/api/mass-asset/${path.basename(item.asset.ref)}`;
            if (urlRemap.has(url)) {
              item.asset.ref = urlRemap.get(url);
            }
          }
        }
        for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
          const ref = massDocument.presentationDefaults?.[key];
          if (ref && !String(ref).startsWith("assets/")) {
            continue;
          }
          const url = ref ? `/api/mass-asset/${path.basename(ref)}` : null;
          if (url && urlRemap.has(url)) {
            massDocument.presentationDefaults[key] = urlRemap.get(url);
          }
        }
        zip.addFile("mass.json", Buffer.from(JSON.stringify(massDocument, null, 2)));

        const zipBuffer = zip.toBuffer();
        const filename = buildExportFilename(state.presentation?.title, state.massStartTime, "-avif.zip");

        const token = crypto.randomBytes(16).toString("hex");
        avifDownloadTokens.set(token, { zipBuffer, filename });
        setTimeout(() => avifDownloadTokens.delete(token), 5 * 60 * 1000);

        socket.emit("export:avif:done", { token });
      } catch (error) {
        socket.emit("export:avif:error", { error: error.message || "Failed to export AVIF ZIP." });
      } finally {
        limitState.release();
      }
    });
  });

  let listeningPort = port;

  server.listen(port, "0.0.0.0", () => {
    const address = server.address();
    listeningPort = typeof address === "object" && address ? address.port : port;
    const host = getLocalIpv4Address();
    serverInfo.host = host;
    serverInfo.port = listeningPort;
    logInfo(`Sacra Lux server listening on 0.0.0.0:${listeningPort}`);
    logInfo(`Sacra Lux URL: http://${host}:${listeningPort}/app`);
    logInfo(`Remote:   http://${host}:${listeningPort}/remote`);
    logInfo(`Screen URL:   http://${host}:${listeningPort}/screen`);

    // Restore the session after the server is bound.
    restoreSession();
    scheduleStartTimer(io);

    const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
    if (currentSlide?.type === "countdown") {
      startCountdownForSlide(io);
    }

    // Broadcast initial state to clients that connected before restore finished.
    io.emit("state:update", getStateSnapshot());
  });

  // Return JSON errors instead of Express 5's default HTML error page.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.expose ? err.message : "Internal server error";
    logger.error(`[server] ${status} ${err.type || "error"}: ${err.message}`);
    res.status(status).json({ error: message });
  });

  async function closeServer() {
    stopAllRuntimeTimers();

    await new Promise((resolve) => io.close(resolve));

    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err && !/not running/i.test(String(err.message || ""))) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  }

  return {
    app,
    io,
    server,
    get port() {
      return listeningPort;
    },
    close: closeServer
  };
}

module.exports = {
  startServer,
  saveCurrentMass
};
