const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { rateLimit } = require("express-rate-limit");
const { itemRuntimeSeconds } = require("../public/client/shared.js");
// Load adm-zip lazily.
let _AdmZip;
function getAdmZip() {
  if (!_AdmZip) _AdmZip = require("adm-zip");
  return _AdmZip;
}

const { importReadings, isKnownReadingStem } = require("./readingsImporter");
const { endingForSection } = require("./readingEndings");
const { fetchUsccbDailyReadings } = require("./lectionaryRss");
const {
  ValidationError,
  assetUrlFromName,
  buildMassDocumentFromLegacyPackage,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  decodeAssetName,
  isMassDocumentV3,
  isSafeAssetName,
  serializeReadingDocument,
  validateMassDocument
} = require("./massDocument");
const { state, getSafeSlideIndex, touch, getStateSnapshot } = require("./state");
const {
  buildPresentationFromOrganizer,
  createManualSlideRecord,
  normalizeBackgroundTheme,
  normalizeCountdownSizePercent,
  normalizeCountdownFont,
  normalizeCountdownStyle,
  normalizeCountdownSec,
  countdownSecError,
  COUNTDOWN_MAX_SEC,
  normalizeSlideshowDurationSec,
  normalizeSlideshowImages,
  normalizeSlideshowLoopCount,
  VALID_PHASES,
  normalizePhase,
  normalizeType,
  normalizeStyleOverrides
} = require("./organizer");
const { saveSession, loadSession, getSessionFilePath } = require("./persistence");
const { getTheme, listThemeEntries, listThemes, DEFAULT_THEME } = require("./themes");
const { getPreferredIpv4Address, listIpv4Addresses } = require("./networkAddress");
const logger = require("./logger");
const { writeFileAtomic } = require("./atomicWrite");
const { createMovieEndGuard } = require("./movieAdvance");
const {
  CURRENT_MASS_DIR,
  InvalidArchiveIdError,
  sanitizeForFilename,
  archiveIdsEqual,
  getArchivePaths,
  readMetadata,
  writeMetadata,
  syncCurrentMassToArchive,
  listMassArchives,
  deleteMassArchive
} = require("./massHistory");
const {
  CONTROL_MODES,
  PIN_HASH_DIGEST,
  PIN_HASH_ITERATIONS,
  RATE_LIMIT_CONFIG,
  clearPinFailures,
  clearStartToken,
  clearControlAccessExcept,
  clearControlSession,
  createConcurrentLimitMiddleware,
  createPinHashRecord,
  createRateLimitMiddleware,
  createSocketRateLimitGuard,
  getActiveLock,
  getClientIp,
  getValidControlSessionToken,
  clearControlAccess,
  clientHasControlSession,
  clientMayControl,
  hasPinConfigured,
  isStartTokenValid,
  issueStartToken,
  noteControlUnlock,
  normalizeControlMode,
  registerPinFailure,
  socketHasControlSession,
  socketMayControl,
  isLoopbackAddress,
  verifyPin
} = require("./security");
const { ALLOWED_NETWORKS_ENV, createHostGuard, createSourceNetworkGuard } = require("./hostGuard");
const { IMAGE_ASSET_EXTENSIONS, MAX_SINGLE_UPLOAD_BYTES } = require("./uploadLimits");
const {
  legacyTextBoundsFromSettings,
  normalizeTextBounds,
  textBoundsToLegacySettings
} = require("./textBounds");

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

const PHASE_LOOP_RESUME_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const logInfo = logger.info;
const logWarn = logger.warn;
const logError = logger.error;
const DEFAULT_SCREEN_SETTINGS = normalizeScreenSettings();
let activeIo = null;
const IMAGE_ASSET_EXT = new Set(IMAGE_ASSET_EXTENSIONS.map((extension) => `.${extension}`));
const VIDEO_ASSET_EXT = new Set([".mp4"]);
const MEDIA_ASSET_EXT = new Set([...IMAGE_ASSET_EXT, ...VIDEO_ASSET_EXT]);
const RECOVERY_DIR = path.join(path.dirname(CURRENT_MASS_DIR), "recovery");

// ── ZIP export helpers ───────────────────────────────────────────────────────

/**
 * Build a replacement Mass in a side directory and move it into place only
 * after `populate` finishes. A throw leaves `current_mass` unchanged.
 */
function replaceCurrentMassDir(populate) {
  const parent = path.dirname(CURRENT_MASS_DIR);
  const token = crypto.randomBytes(6).toString("hex");
  const stagingDir = path.join(parent, `.current_mass-staging-${token}`);
  const backupDir = path.join(parent, `.current_mass-backup-${token}`);
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    populate(stagingDir);
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  let movedCurrent = false;
  try {
    if (fs.existsSync(CURRENT_MASS_DIR)) {
      fs.renameSync(CURRENT_MASS_DIR, backupDir);
      movedCurrent = true;
    }
    fs.renameSync(stagingDir, CURRENT_MASS_DIR);
  } catch (error) {
    if (movedCurrent && fs.existsSync(backupDir)) {
      if (fs.existsSync(CURRENT_MASS_DIR)) {
        fs.rmSync(CURRENT_MASS_DIR, { recursive: true, force: true });
      }
      fs.renameSync(backupDir, CURRENT_MASS_DIR);
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }

  fs.rmSync(backupDir, { recursive: true, force: true });
}

/**
 * Extract one ZIP entry and check the real byte count.
 * Reject the ZIP when the data differs from the declared size or passes a limit.
 * `budget.remainingBytes` tracks the total extracted bytes across entries.
 */
function readZipEntryData(entry, budget) {
  const declaredBytes = Number(entry.header?.size);
  let data;
  try {
    data = entry.getData();
  } catch {
    throw new ValidationError(`Mass ZIP entry "${entry.entryName}" is larger than its declared size.`);
  }
  if (data.length !== declaredBytes) {
    throw new ValidationError(`Mass ZIP entry "${entry.entryName}" does not match its declared size.`);
  }
  if (data.length > MAX_MASS_ZIP_ENTRY_BYTES) {
    throw new ValidationError(
      `Mass ZIP entry "${entry.entryName}" exceeds the ${MAX_MASS_ZIP_ENTRY_BYTES} byte limit.`
    );
  }
  if (budget) {
    budget.remainingBytes -= data.length;
    if (budget.remainingBytes < 0) {
      throw new ValidationError(
        `Mass ZIP uncompressed size exceeds the ${MAX_MASS_ZIP_UNCOMPRESSED_BYTES} byte limit.`
      );
    }
  }
  return data;
}

function writeZipMassPackage(zip, destDir, packageDefinition) {
  fs.mkdirSync(destDir, { recursive: true });
  const budget = { remainingBytes: MAX_MASS_ZIP_UNCOMPRESSED_BYTES };
  const mediaPattern = /^[^/\\:*?"<>|]+\.(jpg|jpeg|png|gif|webp|svg|avif|mp4)$/i;
  const groups = [
    ["readings/", /^[^/\\:*?"<>|]+\.txt$/, ""],
    ["readings/assets/", mediaPattern, "assets"],
    ["assets/", mediaPattern, "assets"],
    ["uploads/", mediaPattern, "assets"]
  ];

  for (const [prefix, pattern, subdir] of groups) {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || entry.entryName === "mass.json" || entry.entryName === "settings.json") continue;
      if (!entry.entryName.startsWith(prefix)) continue;
      if (prefix === "readings/" && entry.entryName.startsWith("readings/assets/")) continue;
      const filename = getSafeZipEntryFilename(entry.entryName, prefix, pattern);
      if (!filename) continue;
      const targetDir = subdir ? path.join(destDir, subdir) : destDir;
      fs.mkdirSync(targetDir, { recursive: true });
      const dest = path.join(targetDir, filename);
      if (prefix === "uploads/" && fs.existsSync(dest)) continue;
      fs.writeFileSync(dest, readZipEntryData(entry, budget));
    }
  }

  fs.writeFileSync(path.join(destDir, "mass.json"), JSON.stringify(packageDefinition, null, 2), "utf8");
  readMassPackageDefinition(destDir, state.screenSettings);
}

/**
 * Save the current Mass state into `~/.sacra-lux/current_mass/mass.json`.
 * Keep current_mass as a self-contained package.
 */
function syncReadingsDocumentsToCurrentMass(documents = [], title = null) {
  fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });

  // Write every file before the stale ones go, so a failed write loses nothing.
  const keep = new Set();
  if (title && String(title).trim()) {
    writeFileAtomic(path.join(CURRENT_MASS_DIR, "mass_title.txt"), `${String(title).trim()}\n`);
    keep.add("mass_title.txt");
  }

  for (const doc of documents) {
    const file = `${doc.stem}.txt`;
    writeFileAtomic(path.join(CURRENT_MASS_DIR, file), serializeReadingDocument(doc));
    keep.add(file);
  }

  for (const file of fs.readdirSync(CURRENT_MASS_DIR)) {
    if (file.endsWith(".txt") && !keep.has(file)) {
      fs.rmSync(path.join(CURRENT_MASS_DIR, file), { force: true });
    }
  }
}

function hasLoadedMass() {
  return !state.startupPrompt;
}

function preserveInvalidCurrentMass() {
  if (state.startupPrompt?.reason !== "invalid-current-mass") return null;
  if (!fs.existsSync(CURRENT_MASS_DIR)) return null;
  fs.mkdirSync(RECOVERY_DIR, { recursive: true });
  const recoveryDir = path.join(
    RECOVERY_DIR,
    `mass-${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`
  );
  fs.cpSync(CURRENT_MASS_DIR, recoveryDir, { recursive: true, errorOnExist: true, force: false });
  return recoveryDir;
}

function saveCurrentMass() {
  if (!hasLoadedMass()) return false;
  fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
  syncReadingsDocumentsToCurrentMass(state.readingsSource?.documents || [], state.presentation?.title || null);
  const massData = buildValidatedMassDocument(state);
  writeFileAtomic(path.join(CURRENT_MASS_DIR, "mass.json"), JSON.stringify(massData, null, 2));
  const archive = syncCurrentMassToArchive({
    currentArchiveId: state.activeMassArchiveId,
    title: state.presentation?.title,
    startTime: state.massStartTime
  });
  state.activeMassArchiveId = archive.id;
  return true;
}

function buildValidatedMassDocument(nextState) {
  const massData = buildMassDocumentFromState(nextState);
  validateMassDocument(massData);
  return massData;
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

function getUnlockMessage() {
  return hasPinConfigured()
    ? "Unlock required."
    : "Network control is off. Set a PIN or allow trusted-LAN control on the operator computer.";
}

function setControlCookie(res, token) {
  res.append(
    "Set-Cookie",
    `sacra_lux_control=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
  );
}

function sendApiError(res, error, fallbackMessage) {
  const status = error instanceof ValidationError || error instanceof InvalidArchiveIdError ? 400 : 500;
  return res.status(status).json({ error: error.message || fallbackMessage });
}

function resolveReadingTxtInMass(folderPath, stem) {
  const rawStem = String(stem ?? "");
  const baseName = `${rawStem}.txt`;
  if (
    !rawStem ||
    rawStem === "." ||
    rawStem === ".." ||
    rawStem.includes("/") ||
    rawStem.includes("\\") ||
    rawStem.includes("\0") ||
    path.isAbsolute(rawStem) ||
    path.basename(baseName) !== baseName
  ) {
    throw new ValidationError("Reading stem must stay inside the current Mass.");
  }

  const massRoot = path.resolve(CURRENT_MASS_DIR);
  const folderRoot = path.resolve(String(folderPath || ""));
  if (folderRoot !== massRoot && !folderRoot.startsWith(`${massRoot}${path.sep}`)) {
    throw new ValidationError("Reading stem must stay inside the current Mass.");
  }

  const filePath = path.resolve(folderRoot, baseName);
  if (
    !filePath.startsWith(`${massRoot}${path.sep}`) ||
    path.basename(filePath) !== baseName ||
    !filePath.endsWith(".txt")
  ) {
    throw new ValidationError("Reading stem must stay inside the current Mass.");
  }
  return filePath;
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

function buildUploadedAssetFilename(filename, mediaExtension, assetsDir) {
  const requestedName = path.basename(String(filename || ""))
    .replace(/[\u0000-\u001f\\/:*?"<>|`]/g, "")
    .trim();
  const fallbackName = `light.${mediaExtension}`;
  let candidate = requestedName || fallbackName;
  const extension = path.extname(candidate).toLowerCase();

  // Keep the original filename, including spaces and capitalization, when it
  // has a supported media extension. Otherwise retain its stem and use the
  // extension that matches the uploaded data.
  if (!MEDIA_ASSET_EXT.has(extension)) {
    const stem = path.basename(candidate, extension).replace(/\.+$/g, "") || "light";
    candidate = `${stem}.${mediaExtension}`;
  }

  const parsed = path.parse(candidate);
  let result = candidate;
  let collisionIndex = 1;
  while (fs.existsSync(path.join(assetsDir, result))) {
    result = `${parsed.name} (${collisionIndex++})${parsed.ext}`;
  }
  return result;
}

const MAX_SLIDESHOW_IMPORT_IMAGES = 500;
const MAX_SLIDESHOW_IMPORT_BYTES = 120 * 1024 * 1024;
// An export must import again, so one ZIP has to hold several uploads of the largest allowed size.
const MAX_MASS_ZIP_COMPRESSED_BYTES = 200 * 1024 * 1024;
// JSON request body limits. Base64 adds one third, so each upload route allows
// its decoded limit times 4/3 plus 1 MB for the JSON wrapper.
// The pages use inline scripts and styles, so the policy allows them but limits every other source to this origin.
const HTML_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN"
});
const MASS_ASSET_SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  "X-Content-Type-Options": "nosniff"
});

const JSON_BODY_LIMIT_DEFAULT = "10mb";
const JSON_BODY_LIMIT_PREVIEW = "1mb";
const MAX_PREVIEW_TEXT_CHARACTERS = 100000;
const JSON_BODY_LIMIT_SINGLE_UPLOAD = `${Math.ceil((MAX_SINGLE_UPLOAD_BYTES * 4) / 3 / (1024 * 1024)) + 1}mb`;
const JSON_BODY_LIMIT_SLIDESHOW_IMPORT = `${Math.ceil((MAX_SLIDESHOW_IMPORT_BYTES * 4) / 3 / (1024 * 1024)) + 1}mb`;
const JSON_BODY_LIMIT_MASS_ZIP = `${Math.ceil((MAX_MASS_ZIP_COMPRESSED_BYTES * 4) / 3 / (1024 * 1024)) + 1}mb`;
const JSON_BODY_LIMITS_BY_PATH = new Map([
  ["/api/preview-reading", JSON_BODY_LIMIT_PREVIEW],
  ["/api/preview-manual-slide", JSON_BODY_LIMIT_PREVIEW],
  ["/api/upload-mass-asset", JSON_BODY_LIMIT_SINGLE_UPLOAD],
  ["/api/upload-image", JSON_BODY_LIMIT_SINGLE_UPLOAD],
  ["/api/import-slideshow-images", JSON_BODY_LIMIT_SLIDESHOW_IMPORT],
  ["/api/import-mass-zip", JSON_BODY_LIMIT_MASS_ZIP]
]);
const MAX_MASS_ZIP_ENTRIES = 1000;
const MAX_MASS_ASSET_FILES = MAX_MASS_ZIP_ENTRIES - 10;
const MAX_MASS_ZIP_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_MASS_ZIP_ENTRY_BYTES = MAX_SINGLE_UPLOAD_BYTES;

/**
 * Rewrite legacy `/static/uploads/<file>` references to `/api/mass-asset/<file>`.
 * The importer copies `uploads/` files into `assets/`, so only the new form resolves.
 */
function rewriteLegacyUploadRefs(value) {
  if (typeof value === "string") {
    const match = value.match(/^\/static\/uploads\/([^/]+)$/);
    return match ? assetUrlFromName(match[1]) : value;
  }
  if (Array.isArray(value)) return value.map(rewriteLegacyUploadRefs);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewriteLegacyUploadRefs(entry)]));
  }
  return value;
}

const ALLOWED_MEDIA_URL_PREFIXES = ["/api/mass-asset/", "/static/assets/", "/static/backgrounds/"];

function isAllowedMediaUrl(value) {
  if (!ALLOWED_MEDIA_URL_PREFIXES.some((prefix) => value.startsWith(prefix))) return false;
  if (value.startsWith("/api/mass-asset/")) {
    const match = value.match(/\/api\/mass-asset\/([^/]+)$/);
    if (!match) return false;
    const name = decodeAssetName(match[1]);
    return name !== "." && name !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(name);
  }
  return true;
}

const BACKGROUND_URL_KEYS = ["darkBackgroundUrl", "lightBackgroundUrl", "colorBackgroundUrl", "imageBackgroundUrl", "wordBackgroundUrl", "graphicBackgroundUrl"];
const BACKGROUND_URL_ERROR = "Background URLs must start with /api/mass-asset/, /static/assets/, or /static/backgrounds/.";

/** Return an error message when a screen settings payload holds a background URL with a bad prefix. */
function screenSettingsUrlError(settings) {
  if (!settings || typeof settings !== "object") {
    return "";
  }
  const bad = BACKGROUND_URL_KEYS.some((key) => {
    const value = settings[key];
    return value !== undefined && value !== null &&
      (typeof value !== "string" || (value && !isAllowedMediaUrl(value)));
  });
  return bad ? BACKGROUND_URL_ERROR : "";
}

/** Return an error message for the first image or movie URL in the organizer payload that has a bad prefix. */
function manualSlideUrlError(manualSlides) {
  for (const manual of Object.values(manualSlides && typeof manualSlides === "object" ? manualSlides : {})) {
    const urls = [manual?.imageUrl, manual?.videoUrl];
    if (urls.some((url) => url !== undefined && url !== null && typeof url !== "string")) {
      return "Image and movie URLs must be strings or null.";
    }
    if (Array.isArray(manual?.images)) {
      for (const entry of manual.images) {
        if (entry && typeof entry === "object" && "url" in entry && typeof entry.url !== "string") {
          return "Image slideshow URLs must be strings.";
        }
        urls.push(typeof entry === "string" ? entry : entry?.url);
      }
    }
    for (const url of urls) {
      if (typeof url === "string" && url.trim() && !isAllowedMediaUrl(url.trim())) {
        return "Image and movie URLs must start with /api/mass-asset/, /static/assets/, or /static/backgrounds/.";
      }
    }
  }
  return "";
}

function massPackageUrlError(packageData) {
  if (isMassDocumentV3(packageData)) {
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      const value = packageData.presentationDefaults?.[key];
      if (!value) continue;
      const valueString = String(value);
      const assetPrefix = valueString.startsWith("assets/") ? "assets/"
        : valueString.startsWith("static/assets/") ? "static/assets/" : null;
      if (assetPrefix) {
        const assetName = valueString.slice(assetPrefix.length);
        if (!isSafeAssetName(assetName) || assetName.includes("/")) {
          return BACKGROUND_URL_ERROR;
        }
        continue;
      }
      if (!isAllowedMediaUrl(String(value))) return BACKGROUND_URL_ERROR;
    }
    return "";
  }

  return screenSettingsUrlError(packageData?.screenSettings || packageData?.displaySettings) ||
    manualSlideUrlError(packageData?.manualSlides || packageData?.manualCues);
}

function parseMassZipDefinition(definitionEntry) {
  const text = readZipEntryData(definitionEntry).toString("utf8");
  let definition;
  try {
    definition = JSON.parse(text);
  } catch (error) {
    throw new ValidationError(error.message || "Mass definition is not valid JSON.");
  }
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new ValidationError("Mass definition must be a JSON object.");
  }
  if (definition.format === "sacra-lux.mass" && definition.version !== 3) {
    throw new ValidationError("Unsupported mass version.");
  }
  return definition.format === "sacra-lux.mass" ? definition : rewriteLegacyUploadRefs(definition);
}

function validateMassPackageDefinition(packageData, screenSettings = DEFAULT_SCREEN_SETTINGS) {
  const urlError = massPackageUrlError(packageData);
  if (urlError) throw new ValidationError(urlError);

  if (isMassDocumentV3(packageData)) {
    buildRuntimeStateFromMassDocument(packageData);
    return;
  }

  if (!Array.isArray(packageData.organizerSequence)) {
    throw new ValidationError("organizerSequence must be an array.");
  }
  normalizeOrganizerSequence(packageData.organizerSequence);
  if (packageData.massStartTime != null && Number.isNaN(new Date(String(packageData.massStartTime)).getTime())) {
    throw new ValidationError("massStartTime must be a valid datetime string.");
  }
  normalizeScreenSettings(packageData.screenSettings || packageData.displaySettings || screenSettings);
}

function validateMassZipArchive(zip, compressedBytes) {
  if (compressedBytes > MAX_MASS_ZIP_COMPRESSED_BYTES) {
    throw new ValidationError(
      `Mass ZIP compressed size exceeds the ${MAX_MASS_ZIP_COMPRESSED_BYTES} byte limit.`
    );
  }

  const entries = zip.getEntries();
  if (entries.length > MAX_MASS_ZIP_ENTRIES) {
    throw new ValidationError(
      `Mass ZIP contains too many entries; the limit is ${MAX_MASS_ZIP_ENTRIES}.`
    );
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const entryParts = String(entry.entryName).split(/[\\/]/);
    if (entry.entryName.startsWith("/") || entryParts.includes("..")) {
      throw new ValidationError(`Mass ZIP entry "${entry.entryName}" leaves the package folder.`);
    }
    const entryBytes = Number(entry.header?.size);
    if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) {
      throw new ValidationError(`Mass ZIP entry "${entry.entryName}" has an invalid size.`);
    }
    if (entryBytes > MAX_MASS_ZIP_ENTRY_BYTES) {
      throw new ValidationError(
        `Mass ZIP entry "${entry.entryName}" exceeds the ${MAX_MASS_ZIP_ENTRY_BYTES} byte limit.`
      );
    }
    totalUncompressedBytes += entryBytes;
    if (totalUncompressedBytes > MAX_MASS_ZIP_UNCOMPRESSED_BYTES) {
      throw new ValidationError(
        `Mass ZIP uncompressed size exceeds the ${MAX_MASS_ZIP_UNCOMPRESSED_BYTES} byte limit.`
      );
    }
  }
}

function parseMassAssetUpload(filename, dataUrl, allowedExtensions = MEDIA_ASSET_EXT) {
  const input = String(dataUrl || "");
  const base64Marker = ";base64,";
  const markerIndex = input.indexOf(base64Marker);
  const mimeType = markerIndex > 5 ? input.slice(5, markerIndex).toLowerCase() : "";
  const encodedStart = markerIndex + base64Marker.length;
  if (!/^data:/.test(input) || !/^(?:image\/[a-z+]+|video\/mp4)$/.test(mimeType) ||
    markerIndex < 0 || !/^[A-Za-z0-9+/=]+$/.test(input.slice(encodedStart))) {
    throw new ValidationError("Invalid media data URL.");
  }

  const mediaExtension = mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/svg+xml"
    ? "svg"
    : mimeType.split("/")[1];
  if (!allowedExtensions.has(`.${mediaExtension}`)) {
    const displayName = String(filename || "file").trim() || "file";
    throw new ValidationError(`Unsupported media type for "${displayName}".`);
  }

  // Decode in bounded chunks. A whole base64 string creates a second large
  // temporary string and can cause a valid upload to fail under CI memory limits.
  const encodedLength = input.length - encodedStart;
  const padding = input.endsWith("==") ? 2 : input.endsWith("=") ? 1 : 0;
  const chunkLength = 4 * 1024 * 1024;
  for (let offset = 0; offset < encodedLength; offset += chunkLength) {
    const chunk = input.slice(encodedStart + offset, encodedStart + Math.min(offset + chunkLength, encodedLength));
    if (!/^[A-Za-z0-9+/=]+$/.test(chunk)) {
      throw new ValidationError("Invalid media data URL.");
    }
  }
  const bytes = Buffer.allocUnsafe(Math.floor(encodedLength * 3 / 4) - padding);
  let offset = 0;
  let decodedOffset = 0;
  while (offset < encodedLength) {
    const chunk = Buffer.from(input.slice(encodedStart + offset, encodedStart + Math.min(offset + chunkLength, encodedLength)), "base64");
    chunk.copy(bytes, decodedOffset);
    decodedOffset += chunk.length;
    offset += chunkLength;
  }
  if (bytes.length > MAX_SINGLE_UPLOAD_BYTES) {
    throw new ValidationError(
      `Media file exceeds the ${Math.floor(MAX_SINGLE_UPLOAD_BYTES / (1024 * 1024))} MB limit.`
    );
  }

  return { filename, mediaExtension, bytes };
}

const MAX_ASSET_NAME_ATTEMPTS = 20;

function saveMassAssetUpload(upload) {
  const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  // Create the file exclusively so a name taken after the existence check is
  // never overwritten. On EEXIST, pick the next free name and try again.
  let safeName;
  for (let attempt = 0; ; attempt += 1) {
    safeName = buildUploadedAssetFilename(upload.filename, upload.mediaExtension, assetsDir);
    try {
      fs.writeFileSync(path.join(assetsDir, safeName), upload.bytes, { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST" || attempt >= MAX_ASSET_NAME_ATTEMPTS) throw err;
    }
  }
  return {
    url: assetUrlFromName(safeName),
    name: path.basename(String(upload.filename || safeName)).slice(0, 200),
    sha256: crypto.createHash("sha256").update(upload.bytes).digest("hex")
  };
}

function getCurrentMassAssetBytes() {
  const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
  if (!fs.existsSync(assetsDir)) return 0;
  return fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((total, entry) => total + fs.statSync(path.join(assetsDir, entry.name)).size, 0);
}

function getCurrentMassAssetFileCount() {
  const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
  if (!fs.existsSync(assetsDir)) return 0;
  return fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .length;
}

function massAssetFileCountError(additionalFiles) {
  const currentCount = getCurrentMassAssetFileCount();
  if (currentCount + additionalFiles <= MAX_MASS_ASSET_FILES) return null;
  return `Mass asset file count exceeds the ${MAX_MASS_ASSET_FILES} file limit; ` +
    `current count is ${currentCount} and the upload adds ${additionalFiles} files.`;
}

function massAssetSizeError(additionalBytes) {
  const currentBytes = getCurrentMassAssetBytes();
  const totalBytes = currentBytes + additionalBytes;
  if (totalBytes <= MAX_MASS_ZIP_COMPRESSED_BYTES) return null;
  return `Mass media exceeds the ${MAX_MASS_ZIP_COMPRESSED_BYTES} byte limit; ` +
    `current total is ${currentBytes} bytes and the new upload is ${additionalBytes} bytes.`;
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

function alignReadingDocumentsWithOrganizer(documents, sequence) {
  const labelsByStem = new Map((sequence || [])
    .filter((item) => item.type === "reading" && item.sourceStem)
    .map((item) => [item.sourceStem, item.label]));
  return (documents || []).map((document) => {
    if (isKnownReadingStem(document.stem)) return document;
    const label = labelsByStem.get(document.stem);
    if (!label) return document;
    return {
      ...document,
      section: label,
      ending: endingForSection(label)
    };
  });
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

// Assign each converted source file a unique AVIF name. Names already used by
// files in the assets directory stay reserved, so sources that share a stem
// (banner.jpg and banner.png) never share one ZIP entry.
function createAvifNameAllocator(assetsDir) {
  const reservedNames = new Set();
  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) reservedNames.add(file.toLowerCase());
  }
  const nameBySource = new Map();
  const assign = (sourcePath, originalName, ext) => {
    if (nameBySource.has(sourcePath)) return nameBySource.get(sourcePath);
    const stem = path.basename(originalName, ext);
    const extLabel = ext.slice(1);
    let candidate = `${stem}.avif`;
    for (let counter = 2; reservedNames.has(candidate.toLowerCase()); counter += 1) {
      candidate = counter === 2 ? `${stem}-${extLabel}.avif` : `${stem}-${extLabel}-${counter}.avif`;
    }
    reservedNames.add(candidate.toLowerCase());
    nameBySource.set(sourcePath, candidate);
    return candidate;
  };
  assign.has = (sourcePath) => nameBySource.has(sourcePath);
  return assign;
}

async function convertImageToAvif(sharp, filePath) {
  try {
    const input = sharp(filePath, { animated: true, pages: -1 });
    const sourcePages = (await input.metadata()).pages || 1;
    const avifBuffer = await input.avif({ quality: 50 }).toBuffer();
    const outputPages = (await sharp(avifBuffer, { animated: true }).metadata()).pages || 1;
    return outputPages >= sourcePages ? avifBuffer : null;
  } catch (_error) {
    logger.warn(`AVIF conversion failed for ${path.basename(filePath)}.`);
    return null;
  }
}

function validateMassDocumentAssetEntries(massDocument, zip) {
  const refs = collectMassAssetRefs(massDocument);
  for (const ref of refs) {
    if (String(ref).startsWith("assets/") && !zip.getEntry(ref)) {
      throw new Error(`Compressed Mass document references missing asset "${ref}".`);
    }
  }
}

function collectMassAssetRefs(massDocument) {
  const refs = [];
  for (const item of massDocument.items || []) {
    if (item.asset?.ref) refs.push(item.asset.ref);
    for (const asset of item.assets || []) {
      if (asset?.ref) refs.push(asset.ref);
    }
  }
  for (const slide of Object.values(massDocument.manualSlides || massDocument.manualCues || {})) {
    if (slide.imageUrl) refs.push(slide.imageUrl);
    if (slide.videoUrl) refs.push(slide.videoUrl);
    for (const image of slide.images || []) {
      const ref = typeof image === "string" ? image : image?.url;
      if (ref) refs.push(ref);
    }
  }
  for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
    if (massDocument.presentationDefaults?.[key]) refs.push(massDocument.presentationDefaults[key]);
    if (massDocument.screenSettings?.[key]) refs.push(massDocument.screenSettings[key]);
  }
  return [...new Set(refs.map(String))];
}

function assetNameFromRef(ref) {
  const value = String(ref);
  if (value.startsWith("assets/")) return value.slice("assets/".length);
  const apiMatch = value.match(/^\/api\/mass-asset\/(.+)$/);
  if (apiMatch) return decodeAssetName(apiMatch[1]);
  const uploadMatch = value.match(/^\/static\/uploads\/(.+)$/);
  if (uploadMatch) return decodeAssetName(uploadMatch[1]);
  return null;
}

function findMissingMassAssets(massDocument, source) {
  const missing = [];
  for (const ref of collectMassAssetRefs(massDocument)) {
    const name = assetNameFromRef(ref);
    if (!name || !isSafeAssetName(name)) continue;
    const locations = source.kind === "zip"
      ? [`assets/${name}`, `readings/assets/${name}`, `uploads/${name}`]
      : [path.join(source.root, "assets", name), path.join(source.root, "readings", "assets", name), path.join(source.root, "uploads", name)];
    const exists = source.kind === "zip"
      ? locations.some((entryName) => source.zip.getEntry(entryName))
      : locations.some((filePath) => fs.existsSync(filePath));
    if (!exists) missing.push(name);
  }
  return missing;
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
      for (const asset of item.assets || []) {
        if (asset?.ref) refs.push(asset.ref);
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (packageInfo.raw.presentationDefaults?.[key]) refs.push(packageInfo.raw.presentationDefaults[key]);
    }
  } else {
    for (const slide of Object.values(packageInfo.raw.manualSlides || {})) {
      if (slide.imageUrl) refs.push(slide.imageUrl);
      if (slide.videoUrl) refs.push(slide.videoUrl);
      for (const image of slide.images || []) {
        const url = typeof image === "string" ? image : image?.url;
        if (url) refs.push(url);
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (packageInfo.raw.screenSettings?.[key]) refs.push(packageInfo.raw.screenSettings[key]);
    }
  }

  const CONVERTIBLE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif"]);
  const assignAvifName = createAvifNameAllocator(path.join(packageDir, "assets"));
  const avifBySource = new Map();
  // Originals that became AVIF copies. The leftover loop below must not add them again.
  const convertedAssetFiles = new Set();
  for (const ref of refs) {
    let filePath = null;
    let originalName = null;

    const assetRefMatch = String(ref).match(/^assets\/([^/]+)$/);
    if (assetRefMatch) {
      originalName = assetRefMatch[1];
      if (isSafeAssetName(originalName)) filePath = path.join(packageDir, "assets", originalName);
    }
    const assetMatch = String(ref).match(/\/api\/mass-asset\/([^/]+)$/);
    if (assetMatch) {
      originalName = decodeAssetName(assetMatch[1]);
      if (isSafeAssetName(originalName)) filePath = path.join(packageDir, "assets", originalName);
    }
    const uploadMatch = String(ref).match(/\/static\/uploads\/([^/]+)$/);
    if (uploadMatch) {
      originalName = uploadMatch[1];
      if (isSafeAssetName(originalName)) filePath = path.join(packageDir, "uploads", originalName);
    }
    if (!filePath || !originalName || !fs.existsSync(filePath)) continue;
    const ext = path.extname(originalName).toLowerCase();

    if (avif && CONVERTIBLE_EXT.has(ext)) {
      const isNewSource = !assignAvifName.has(filePath);
      const avifName = assignAvifName(filePath, originalName, ext);
      if (isNewSource) {
        avifBySource.set(filePath, await convertImageToAvif(sharp, filePath));
      }
      const avifBuffer = avifBySource.get(filePath);
      if (avifBuffer) {
        if (isNewSource) zip.addFile(`assets/${avifName}`, avifBuffer);
        urlRemap.set(ref, `assets/${avifName}`);
        urlRemap.set(`assets/${originalName}`, `assets/${avifName}`);
        convertedAssetFiles.add(originalName);
      } else {
        zip.addFile(`assets/${originalName}`, fs.readFileSync(filePath));
      }
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
      for (const asset of item.assets || []) {
        if (asset?.ref && urlRemap.has(asset.ref)) {
          asset.ref = urlRemap.get(asset.ref);
        }
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (massDocument.presentationDefaults?.[key] && urlRemap.has(massDocument.presentationDefaults[key])) {
        massDocument.presentationDefaults[key] = urlRemap.get(massDocument.presentationDefaults[key]);
      }
    }
    validateMassDocumentAssetEntries(massDocument, zip);
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
      for (const asset of item.assets || []) {
        if (asset?.ref && urlRemap.has(asset.ref)) {
          asset.ref = urlRemap.get(asset.ref);
        }
      }
    }
    for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
      if (massDocument.presentationDefaults?.[key] && urlRemap.has(massDocument.presentationDefaults[key])) {
        massDocument.presentationDefaults[key] = urlRemap.get(massDocument.presentationDefaults[key]);
      }
    }
    validateMassDocumentAssetEntries(massDocument, zip);
    zip.addFile("mass.json", Buffer.from(JSON.stringify(massDocument, null, 2)));
  }

  const assetsDir = path.join(packageDir, "assets");
  if (fs.existsSync(assetsDir)) {
    for (const dirent of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      const file = dirent.name;
      if (dirent.isFile() && !convertedAssetFiles.has(file) && !zip.getEntry(`assets/${file}`)) {
        zip.addFile(`assets/${file}`, fs.readFileSync(path.join(assetsDir, file)));
      }
    }
  }

  return zip.toBuffer();
}

function applyMassPackageFromCurrentDir(ioRef, packageData) {
  const urlError = massPackageUrlError(packageData);
  if (urlError) throw new ValidationError(urlError);

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
  state.startupPrompt = null;

  state.screenSettings = normalizeScreenSettings(runtime.screenSettings || DEFAULT_SCREEN_SETTINGS);
  state.organizerSequence = sortOrganizerSequenceByPhase(normalizeOrganizerSequence(runtime.organizerSequence || []));
  state.manualSlides = mergeManualSlideState(state.organizerSequence, runtime.manualSlides || {});
  state.organizerRevision += 1;
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

  // Reset before arming the clock. Catch-up is the last word, so a Mass whose
  // gathering window or start time has already passed stays on that sequence.
  state.currentSlideIndex = getSafeSlideIndex(0);
  resetDisplayOverrides();
  stopActiveSlideTimers();
  resetPlaybackErrors();

  if (runtime.massStartTime && typeof runtime.massStartTime === "string") {
    state.massStartTime = runtime.massStartTime;
    scheduleStartTimer(ioRef);
  } else {
    state.massStartTime = null;
    clearStartTimers();
  }

  touch();
  ioRef.emit("state:update", getStateSnapshot());
}

function resetPresentationRuntimeState() {
  state.presentation = {
    title: "No presentation loaded",
    sourceFile: null,
    slides: []
  };
  state.readingsSource = { folderPath: null, documents: [] };
  state.organizerSequence = [];
  state.manualSlides = {};
  state.currentSlideIndex = 0;
  state.massStartTime = null;
  state.activeMassArchiveId = null;
  resetDisplayOverrides();
  stopActiveSlideTimers();
  resetPlaybackErrors();
  clearStartTimers();
}

function setStartupPrompt(reason, message = null) {
  state.startupPrompt = {
    type: "mass-library",
    reason: String(reason || "missing-current-mass")
  };
  if (message) state.startupPrompt.message = String(message);
}

function publicStartupMessage(error) {
  return String(error?.message || "The current Mass did not load.")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]+/g, "[path]");
}

function archiveExistsOnDisk(archiveId) {
  if (typeof archiveId !== "string" || !archiveId) return false;
  try {
    return fs.existsSync(getArchivePaths(archiveId).archiveDir);
  } catch {
    return false;
  }
}

function restoreCurrentMassOrPrompt(ioRef, savedArchiveId = null) {
  const currentMassJsonPath = path.join(CURRENT_MASS_DIR, "mass.json");
  if (!fs.existsSync(currentMassJsonPath)) {
    resetPresentationRuntimeState();
    setStartupPrompt("missing-current-mass");
    return false;
  }

  try {
    const packageInfo = readMassPackageDefinition(CURRENT_MASS_DIR, state.screenSettings);
    state.activeMassArchiveId = null;
    applyMassPackageFromCurrentDir(ioRef, packageInfo.raw);
    // Keep the saved archive active so the next save updates it and makes no copy.
    state.activeMassArchiveId = archiveExistsOnDisk(savedArchiveId) ? savedArchiveId : null;
    return true;
  } catch (error) {
    resetPresentationRuntimeState();
    setStartupPrompt("invalid-current-mass", publicStartupMessage(error));
    logWarn(`[persistence] Could not restore current_mass package from "${CURRENT_MASS_DIR}": ${error.message}`);
    return false;
  }
}

const SAVED_SLIDE_MAX_AGE_MS = 4 * 60 * 60 * 1000;

function restoreSavedSlide(session) {
  const slideId = typeof session?.currentSlideId === "string" ? session.currentSlideId : "";
  const savedAt = Date.parse(session?.currentSlideChangedAt || session?.savedAt || "");
  if (!slideId || !Number.isFinite(savedAt)) return false;
  const ageMs = Date.now() - savedAt;
  if (ageMs < 0 || ageMs > SAVED_SLIDE_MAX_AGE_MS) return false;

  const slideIndex = (state.presentation?.slides || []).findIndex((slide) => slide.id === slideId);
  if (slideIndex < 0) return false;
  state.currentSlideIndex = slideIndex;
  state.currentSlideId = slideId;
  state.currentSlideChangedAt = new Date(savedAt).toISOString();
  return true;
}

function restoreDisplayOverrides(session) {
  const savedAt = Date.parse(session?.savedAt || "");
  const savedAge = Date.now() - savedAt;
  if (!Number.isFinite(savedAt) || savedAge < 0 || savedAge > SAVED_SLIDE_MAX_AGE_MS) return false;

  if (session?.interstitialHoldActive) {
    const holdIndex = Number(session.interstitialHoldSlideIndex);
    const holdSlide = state.presentation?.slides?.[holdIndex];
    if (Number.isInteger(holdIndex) && holdSlide?.type === "interstitial") {
      state.interstitialHoldSlideIndex = holdIndex;
      state.interstitialHoldReturnSlideIndex = Number.isInteger(session.interstitialHoldReturnSlideIndex)
        ? getSafeSlideIndex(session.interstitialHoldReturnSlideIndex)
        : state.currentSlideIndex;
      state.interstitialHoldResumeState = session.interstitialHoldResumeState || null;
      state.interstitialHoldActive = true;
      state.isBlack = false;
      return true;
    }
  }

  state.interstitialHoldActive = false;
  state.interstitialHoldSlideIndex = null;
  state.interstitialHoldReturnSlideIndex = null;
  state.interstitialHoldResumeState = null;
  state.isBlack = Boolean(session?.isBlack);
  return true;
}

/** Return `value` as a number when it is finite, otherwise `fallback`. A null value counts as missing. */
function finiteOr(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
  const readingTextSizePx = Math.min(200, Math.max(0, finiteOr(input.readingTextSizePx, finiteOr(current.readingTextSizePx, 0))));
  const readingPassageFontRaw = String(input.readingPassageFont ?? current.readingPassageFont ?? "");
  const readingPassageFont = !readingPassageFontRaw || GOOGLE_FONTS.has(readingPassageFontRaw) ? readingPassageFontRaw : "";
  const readingPassagePosition = ["top", "middle", "bottom"].includes(String(input.readingPassagePosition || current.readingPassagePosition || "top"))
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
  const legacyGeometryKeys = [
    "readingTextMarginXPx",
    "readingTextMarginYPx",
    "readingTextHeightPx",
    "readingPassageYPx",
    "readingPassageWidthPx",
    "textSlideMarginXPx",
    "textSlideMarginYPx",
    "textSlideTextHeightPx"
  ];
  const hasIncomingBounds = Object.prototype.hasOwnProperty.call(input, "textBounds");
  const hasIncomingLegacyGeometry = legacyGeometryKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
  const currentBounds = current.textBounds || legacyTextBoundsFromSettings(current);
  const textBounds = hasIncomingBounds
    ? normalizeTextBounds(input.textBounds, currentBounds)
    : hasIncomingLegacyGeometry
      ? legacyTextBoundsFromSettings({ ...current, ...input, resolution })
      : normalizeTextBounds(currentBounds);
  const legacyGeometry = textBoundsToLegacySettings(textBounds, resolution);

  // Reference and section title style. A setting that is not saved yet starts at the
  // value the screen used before it existed, so older sessions look the same.
  const hexOr = (value, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? String(value) : fallback);
  const passageSizePx = Math.min(90, Math.max(20, Number(input.readingPassageSizePx) || current.readingPassageSizePx || 44));
  const passageBold = Boolean(input.readingPassageBold ?? current.readingPassageBold ?? true);
  const passageColor = hexOr(input.readingPassageColor, current.readingPassageColor || "#e8d5a0");
  const passageItalic = Boolean(input.readingPassageItalic ?? current.readingPassageItalic ?? false);
  const passageShadow = Boolean(
    input.readingPassageShadow ?? current.readingPassageShadow ?? input.readingTextShadow ?? current.readingTextShadow ?? true
  );
  const hasSavedSectionFont = Object.prototype.hasOwnProperty.call(current, "readingSectionFont");
  const sectionFontRaw = String(input.readingSectionFont ?? (hasSavedSectionFont ? current.readingSectionFont : readingPassageFont));
  const referenceTextStyle = {
    readingPassageItalic: passageItalic,
    readingPassageShadow: passageShadow,
    readingPassageLineHeight: Math.round(Math.min(3, Math.max(1, Number(input.readingPassageLineHeight) || current.readingPassageLineHeight || 1.15)) * 100) / 100,
    readingPassageLetterSpacingPx: Math.round(Math.min(10, Math.max(-2, finiteOr(input.readingPassageLetterSpacingPx, finiteOr(current.readingPassageLetterSpacingPx, passageSizePx * 0.03)))) * 10) / 10,
    readingSectionFont: GOOGLE_FONTS.has(sectionFontRaw)
      ? sectionFontRaw
      : (GOOGLE_FONTS.has(current.readingSectionFont)
        ? current.readingSectionFont
        : (!hasSavedSectionFont && GOOGLE_FONTS.has(readingPassageFont) ? readingPassageFont : "")),
    readingSectionSizePx: Math.round(Math.min(90, Math.max(10, Number(input.readingSectionSizePx) || current.readingSectionSizePx || passageSizePx / 2))),
    readingSectionColor: hexOr(input.readingSectionColor, current.readingSectionColor || passageColor),
    readingSectionBold: Boolean(input.readingSectionBold ?? current.readingSectionBold ?? passageBold),
    readingSectionItalic: Boolean(input.readingSectionItalic ?? current.readingSectionItalic ?? passageItalic),
    readingSectionShadow: Boolean(input.readingSectionShadow ?? current.readingSectionShadow ?? passageShadow)
  };

  return {
    ...referenceTextStyle,
    fontFamily,
    fontSizePx: Math.min(200, Math.max(24, Number(input.fontSizePx) || current.fontSizePx || 60)),
    darkBackgroundUrl: String(
      darkBackgroundUrl || current.darkBackgroundUrl || "/static/assets/default-text-background.avif"
    ),
    lightBackgroundUrl: String(
      lightBackgroundUrl || current.lightBackgroundUrl || "/static/assets/default-interstitial.png"
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
    readingPassageOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, finiteOr(input.readingPassageOutlineWidthPx, finiteOr(current.readingPassageOutlineWidthPx, 1)))) * 10) / 10,
    readingSectionOutline: Boolean(input.readingSectionOutline ?? current.readingSectionOutline ?? false),
    readingSectionOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingSectionOutlineColor || "")) ? String(input.readingSectionOutlineColor) : (current.readingSectionOutlineColor || "#000000"),
    readingSectionOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, finiteOr(input.readingSectionOutlineWidthPx, finiteOr(current.readingSectionOutlineWidthPx, 1)))) * 10) / 10,
    readingShowPageNumber: Boolean(input.readingShowPageNumber ?? current.readingShowPageNumber ?? true),
    readingShowLabel: Boolean(input.readingShowLabel ?? current.readingShowLabel ?? true),
    readingShowEnding: Boolean(input.readingShowEnding ?? current.readingShowEnding ?? true),
    readingTextMarginXPx: legacyGeometry.readingTextMarginXPx,
    readingTextMarginYPx: legacyGeometry.readingTextMarginYPx,
    readingTextHeightPx: legacyGeometry.readingTextHeightPx,
    readingPassageYPx: legacyGeometry.readingPassageYPx,
    readingPassageWidthPx: legacyGeometry.readingPassageWidthPx,
    readingLineHeight: Math.round(Math.min(3.0, Math.max(1.0, Number(input.readingLineHeight) || current.readingLineHeight || 1.58)) * 100) / 100,
    readingLetterSpacingPx: Math.round(Math.min(10, Math.max(-2, finiteOr(input.readingLetterSpacingPx, finiteOr(current.readingLetterSpacingPx, 0)))) * 10) / 10,
    readingTextItalic: Boolean(input.readingTextItalic ?? current.readingTextItalic ?? false),
    readingTextOutline: Boolean(input.readingTextOutline ?? current.readingTextOutline ?? false),
    readingTextOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.readingTextOutlineColor || "")) ? String(input.readingTextOutlineColor) : (current.readingTextOutlineColor || "#000000"),
    readingTextOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, finiteOr(input.readingTextOutlineWidthPx, finiteOr(current.readingTextOutlineWidthPx, 1)))) * 10) / 10,
    readingTextShadow: Boolean(input.readingTextShadow ?? current.readingTextShadow ?? true),
    // Text/Prayer/Hymn slide layout
    textSlideTextAlign: ["left", "center", "right"].includes(String(input.textSlideTextAlign || current.textSlideTextAlign || "center"))
      ? String(input.textSlideTextAlign || current.textSlideTextAlign || "center") : "center",
    textSlideTextVAlign: ["top", "middle", "bottom"].includes(String(input.textSlideTextVAlign || current.textSlideTextVAlign || "middle"))
      ? String(input.textSlideTextVAlign || current.textSlideTextVAlign || "middle") : "middle",
    textSlideTextFont: GOOGLE_FONTS.has(String(input.textSlideTextFont ?? current.textSlideTextFont ?? ""))
      ? String(input.textSlideTextFont ?? current.textSlideTextFont ?? "") : "",
    textSlideTextSizePx: Math.min(200, Math.max(0, finiteOr(input.textSlideTextSizePx, finiteOr(current.textSlideTextSizePx, 0)))),
    textSlideTextBold: Boolean(input.textSlideTextBold ?? current.textSlideTextBold ?? false),
    textSlideTextItalic: Boolean(input.textSlideTextItalic ?? current.textSlideTextItalic ?? false),
    textSlideTextColor: /^#[0-9a-fA-F]{6}$/.test(String(input.textSlideTextColor || "")) ? String(input.textSlideTextColor) : (current.textSlideTextColor || "#f8f8f8"),
    textSlideLineHeight: Math.round(Math.min(3.0, Math.max(1.0, Number(input.textSlideLineHeight) || current.textSlideLineHeight || 1.55)) * 100) / 100,
    textSlideLetterSpacingPx: Math.round(Math.min(10, Math.max(-2, finiteOr(input.textSlideLetterSpacingPx, finiteOr(current.textSlideLetterSpacingPx, 0)))) * 10) / 10,
    textSlideTextOutline: Boolean(input.textSlideTextOutline ?? current.textSlideTextOutline ?? false),
    textSlideTextOutlineColor: /^#[0-9a-fA-F]{6}$/.test(String(input.textSlideTextOutlineColor || "")) ? String(input.textSlideTextOutlineColor) : (current.textSlideTextOutlineColor || "#000000"),
    textSlideTextOutlineWidthPx: Math.round(Math.min(20, Math.max(0.5, finiteOr(input.textSlideTextOutlineWidthPx, finiteOr(current.textSlideTextOutlineWidthPx, 1)))) * 10) / 10,
    textSlideTextShadow: Boolean(input.textSlideTextShadow ?? current.textSlideTextShadow ?? true),
    textSlideShowPageNumber: Boolean(input.textSlideShowPageNumber ?? current.textSlideShowPageNumber ?? true),
    textSlideMarginXPx: legacyGeometry.textSlideMarginXPx,
    textSlideMarginYPx: legacyGeometry.textSlideMarginYPx,
    textSlideTextHeightPx: legacyGeometry.textSlideTextHeightPx,
    ...normalizeTypeFontSettings(input, current, "hymn"),
    ...normalizeTypeFontSettings(input, current, "prayer"),
    textBounds
  };
}

/**
 * Font choices for hymn and prayer slides. A type with no saved choice starts
 * from the Text slide choice, so settings saved before the split look the same.
 */
function normalizeTypeFontSettings(input, current, prefix) {
  const pick = (key, fallback) => input[`${prefix}${key}`] ?? current[`${prefix}${key}`] ?? input[`textSlide${key}`] ?? fallback;
  const font = String(input[`${prefix}TextFont`] ?? (current[`${prefix}TextFont`] || input.textSlideTextFont || current.textSlideTextFont || ""));
  return {
    [`${prefix}TextFont`]: GOOGLE_FONTS.has(font) ? font : "",
    [`${prefix}TextSizePx`]: Math.min(200, Math.max(0, Number(pick("TextSizePx", current.textSlideTextSizePx ?? 0)) || 0)),
    [`${prefix}TextBold`]: Boolean(pick("TextBold", current.textSlideTextBold ?? false)),
    [`${prefix}TextItalic`]: Boolean(pick("TextItalic", current.textSlideTextItalic ?? false))
  };
}

function rebuildPresentationFromOrganizer(options) {
  const previousSlides = state.presentation?.slides || [];
  const previousCurrentSlide = previousSlides[state.currentSlideIndex];
  const previousCurrentSlideId = previousCurrentSlide?.id || state.currentSlideId;
  const previousCurrentItemId = previousCurrentSlide?.organizerItemId || null;
  const previousHoldSlide = previousSlides[state.interstitialHoldSlideIndex];
  const previousHoldSlideId = previousHoldSlide?.id || null;
  const previousHoldItemId = previousHoldSlide?.organizerItemId || null;
  const previousReturnSlide = previousSlides[state.interstitialHoldReturnSlideIndex];
  const previousReturnSlideId = previousReturnSlide?.id || null;
  const previousReturnItemId = previousReturnSlide?.organizerItemId || null;

  state.presentation = buildPresentationFromOrganizer(options);
  const slides = state.presentation?.slides || [];
  const findSlideIndex = (slideId, organizerItemId, fallbackIndex) => {
    const exactIndex = slideId ? slides.findIndex((slide) => slide.id === slideId) : -1;
    if (exactIndex >= 0) return exactIndex;
    const itemIndex = organizerItemId
      ? slides.findIndex((slide) => slide.organizerItemId === organizerItemId)
      : -1;
    return itemIndex >= 0 ? itemIndex : getSafeSlideIndex(fallbackIndex);
  };

  state.currentSlideIndex = findSlideIndex(
    previousCurrentSlideId,
    previousCurrentItemId,
    state.currentSlideIndex
  );
  state.currentSlideId = slides[state.currentSlideIndex]?.id || null;

  if (state.interstitialHoldActive) {
    let holdIndex = previousHoldSlideId
      ? slides.findIndex((slide) => slide.id === previousHoldSlideId && slide.type === "interstitial")
      : -1;
    if (holdIndex < 0 && previousHoldItemId) {
      holdIndex = slides.findIndex((slide) => slide.organizerItemId === previousHoldItemId && slide.type === "interstitial");
    }
    if (holdIndex < 0) {
      holdIndex = slides.findIndex((slide) => slide.type === "interstitial");
    }
    if (holdIndex >= 0) {
      state.interstitialHoldSlideIndex = holdIndex;
      state.interstitialHoldReturnSlideIndex = findSlideIndex(
        previousReturnSlideId,
        previousReturnItemId,
        state.currentSlideIndex
      );
    } else {
      state.interstitialHoldActive = false;
      state.interstitialHoldSlideIndex = null;
      state.interstitialHoldReturnSlideIndex = null;
      state.interstitialHoldResumeState = null;
    }
  }
  invalidateStateCache();
}

function repaginateReadingSlidesIfNeeded() {
  rebuildPresentationFromOrganizer({
    title: state.presentation.title,
    documents: Array.isArray(state.readingsSource?.documents) ? state.readingsSource.documents : [],
    sequence: state.organizerSequence,
    manualSlides: state.manualSlides,
    screenSettings: state.screenSettings
  });
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
    merged[item.id].styleOverrides = normalizeStyleOverrides(merged[item.id].styleOverrides);
    merged[item.id].countdownFont = normalizeCountdownFont(merged[item.id].countdownFont);
    if (item.type === "countdown") {
      merged[item.id].countdownSec = normalizeCountdownSec(merged[item.id].countdownSec);
    }
    if (item.type === "imageSlideshow") {
      merged[item.id].images = normalizeSlideshowImages(merged[item.id].images);
      merged[item.id].slideshowDurationSec = normalizeSlideshowDurationSec(merged[item.id].slideshowDurationSec);
      merged[item.id].slideshowLoopCount = normalizeSlideshowLoopCount(merged[item.id].slideshowLoopCount);
      merged[item.id].imageUrl = null;
    }
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
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ValidationError("Each organizer item must be an object.");
    }
    const phase = normalizePhase(item.phase ?? item.section);
    return {
      id: String(item.id || `item-${index + 1}`),
      type: normalizeType(item.type ?? item.kind),
      label: String(item.label || "Slide"),
      sourceStem: item.sourceStem ? String(item.sourceStem) : null,
      ...(Number(item.psalmRefrainIndex) > 0
        ? { psalmRefrainIndex: Math.floor(Number(item.psalmRefrainIndex)) }
        : {}),
      styleOverrides: normalizeStyleOverrides(item.styleOverrides),
      phase,
      backgroundTheme: normalizeBackgroundTheme(
        item.backgroundTheme ??
        item.backgroundType ??
        (item.presentation?.background === "dark" ? "dark" : item.presentation?.background === "light" ? "light" : item.presentation?.background),
        item.type ?? item.kind
      ),
      durationSec: Math.max(1, Math.min(3600, Math.trunc(Number(item.durationSec) || 10)))
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

/**
 * Order items by phase (pre, gathering, mass, post).
 * Array.prototype.sort is stable, so items keep their relative order within a phase.
 */
function sortOrganizerSequenceByPhase(sequence) {
  return [...sequence].sort((a, b) => VALID_PHASES.indexOf(a.phase) - VALID_PHASES.indexOf(b.phase));
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
let _massSaveError = "";

// ── Mass start-time automation ───────────────────────────────────────────────
// _startTimer arms the gathering lead-in; _massStartTimer is the hard cutover
// to the first Mass slide at the scheduled wall-clock time.
let _startTimer = null;
let _massStartTimer = null;
let _gatheringStartedForMassKey = null;

function clearStartTimers() {
  if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
  if (_massStartTimer) { clearTimeout(_massStartTimer); _massStartTimer = null; }
}

// setTimeout stores its delay in a 32-bit signed integer. A start time more
// than ~24.8 days away overflows: Node warns with TimeoutOverflowWarning and
// fires the callback almost immediately, which would start gathering (and then
// the Mass cutover) the moment a far-future date is saved. Wait in capped
// chunks and re-arm until the full delay has elapsed. `assign` stores the live
// handle so clearStartTimers() can cancel a chain that is still waiting.
const MAX_TIMER_DELAY_MS = 2147483647;

function scheduleLongTimeout(delayMs, callback, assign) {
  const remaining = Math.max(0, Number(delayMs) || 0);
  assign(setTimeout(() => {
    if (remaining > MAX_TIMER_DELAY_MS) {
      scheduleLongTimeout(remaining - MAX_TIMER_DELAY_MS, callback, assign);
    } else {
      assign(null);
      callback();
    }
  }, Math.min(remaining, MAX_TIMER_DELAY_MS)));
}

// ── Movie-slide automation ───────────────────────────────────────────────────
// `_movieTimer` is the fallback advance for a movie the phase timer stepped
// aside for; `_movieEndGuard` dedupes several screen windows reporting the end
// of the same movie.
let _movieTimer = null;
const _movieEndGuard = createMovieEndGuard();
let _moviePlaybackStartedAt = null;
let _moviePlaybackSlideId = null;

// ── Pre-mass slideshow automation ────────────────────────────────────────────
let _preMassTimer = null;
let _preMassDeadlineAt = null;
let _preMassDeadlineSlideId = null;

// ── Gathering slideshow automation ───────────────────────────────────────────
let _gatheringTimer = null;
let _gatheringDeadlineAt = null;
let _gatheringDeadlineSlideId = null;

// ── Image Slideshow slide automation ─────────────────────────────────────────
let _imageSlideshowTimer = null;
const _imageSlideshowFailedUrls = new Set();
// Direction of the last manual slide step (1 = next, -1 = prev).
let _manualNavigationDirection = 1;

function stopImageSlideshowTimer({ resetProgress = true, clearError = false } = {}) {
  if (_imageSlideshowTimer) {
    clearTimeout(_imageSlideshowTimer);
    _imageSlideshowTimer = null;
  }
  state.imageSlideshowEndsAt = null;
  if (resetProgress) state.imageSlideshowLoopIteration = 1;
  if (clearError) state.imageSlideshowError = null;
}

function resetPlaybackErrors() {
  state.moviePlaybackError = null;
  state.imageSlideshowError = null;
  _imageSlideshowFailedUrls.clear();
}

function removeSavedMassAssets(savedAssets) {
  const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
  for (const asset of savedAssets) {
    fs.rmSync(path.join(assetsDir, path.basename(decodeAssetName(asset.url))), { force: true });
  }
}

function getReferencedMassAssetNames() {
  const names = new Set();
  const addReference = (reference) => {
    const value = String(reference || "").split(/[?#]/, 1)[0];
    const apiMatch = value.match(/^\/api\/mass-asset\/([^/]+)$/);
    const packageMatch = value.match(/^assets\/([^/]+)$/);
    const encodedName = apiMatch?.[1] || packageMatch?.[1];
    if (!encodedName) return;
    const name = path.basename(decodeAssetName(encodedName));
    if (isSafeAssetName(name)) names.add(name);
  };

  for (const slide of Object.values(state.manualSlides || {})) {
    addReference(slide?.imageUrl);
    addReference(slide?.videoUrl);
    for (const image of slide?.images || []) {
      addReference(typeof image === "string" ? image : image?.url);
    }
  }
  for (const slide of state.presentation?.slides || []) {
    addReference(slide?.imageUrl);
    addReference(slide?.videoUrl);
  }
  for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
    addReference(state.screenSettings?.[key]);
  }
  return names;
}

function removeUnusedMassAssets() {
  const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
  if (!fs.existsSync(assetsDir)) return { deletedFiles: 0, deletedBytes: 0 };

  const referencedNames = getReferencedMassAssetNames();
  let deletedFiles = 0;
  let deletedBytes = 0;
  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile() || referencedNames.has(entry.name)) continue;
    const filePath = path.join(assetsDir, entry.name);
    const size = fs.statSync(filePath).size;
    fs.rmSync(filePath);
    deletedFiles += 1;
    deletedBytes += size;
  }
  return { deletedFiles, deletedBytes };
}

function slideshowAssetPathFromUrl(url) {
  const match = String(url || "").match(/^\/api\/mass-asset\/([^/]+)$/);
  if (!match) return null;
  const filename = path.basename(decodeAssetName(match[1]));
  const filePath = path.join(CURRENT_MASS_DIR, "assets", filename);
  if (!filePath.startsWith(path.join(CURRENT_MASS_DIR, "assets") + path.sep)) return null;
  return filePath;
}

function isPlayableImageSlideshowSlide(slide) {
  if (!slide || slide.type !== "imageSlideshow" || slide.slideshowEmpty || !slide.imageUrl) return false;
  if (_imageSlideshowFailedUrls.has(slide.imageUrl)) return false;
  const withoutQuery = String(slide.imageUrl).split(/[?#]/, 1)[0];
  if (!IMAGE_ASSET_EXT.has(path.extname(withoutQuery).toLowerCase())) return false;
  const localPath = slideshowAssetPathFromUrl(slide.imageUrl);
  return !localPath || fs.existsSync(localPath);
}

function getPlayableImageSlideshowEntries(organizerItemId) {
  return (state.presentation?.slides || [])
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => slide.organizerItemId === organizerItemId && isPlayableImageSlideshowSlide(slide));
}

function getRunnablePhaseIndices(phase) {
  return (state.presentation?.slides || []).reduce((indices, slide, index) => {
    if (slide.phase !== phase) return indices;
    if (slide.type === "imageSlideshow" && !isPlayableImageSlideshowSlide(slide)) return indices;
    indices.push(index);
    return indices;
  }, []);
}

function scheduleRuntimeForCurrentSlide(ioRef) {
  // Whatever fallback was armed for the previous slide no longer applies.
  stopMovieAutoAdvanceTimer();
  const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
  if (!currentSlide) return;
  if (currentSlide.type === "imageSlideshow") {
    scheduleImageSlideshowSlide(ioRef);
    return;
  }
  if (currentSlide.type === "countdown") {
    startCountdownForSlide(ioRef);
    return;
  }
  if (state.preMassRunning) scheduleNextPreMassSlide(ioRef);
  if (state.gatheringRunning) scheduleNextGatheringSlide(ioRef);
  if (state.postMassRunning) scheduleNextPostMassSlide(ioRef);
}

// Last slide index belonging to the current slide's organizer item, so an
// advance skips the remaining (possibly unplayable) pages of the same slideshow.
function getCurrentItemLastIndex() {
  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];
  let lastIndex = state.currentSlideIndex;
  if (!currentSlide?.organizerItemId) return lastIndex;
  while (slides[lastIndex + 1]?.organizerItemId === currentSlide.organizerItemId) lastIndex++;
  return lastIndex;
}

function advanceAfterImageSlideshow(ioRef, { direction = 1 } = {}) {
  const slides = state.presentation?.slides || [];
  const afterIndex = getCurrentItemLastIndex();
  let nextIndex = -1;

  if (state.preMassRunning || state.postMassRunning) {
    const indices = getRunnablePhaseIndices(state.preMassRunning ? "pre" : "post");
    if (indices.length === 0) {
      if (state.preMassRunning) stopPreMassTimer();
      else stopPostMassTimer();
    } else {
      nextIndex = indices.find((index) => index > afterIndex) ?? indices[0];
    }
  } else if (state.gatheringRunning) {
    const indices = getRunnablePhaseIndices("gathering");
    nextIndex = indices.find((index) => index > afterIndex) ?? -1;
    if (nextIndex < 0) {
      stopGatheringTimer();
      nextIndex = slides.findIndex((slide) => slide.phase === "mass");
    }
  } else if (direction < 0) {
    const currentItemId = slides[state.currentSlideIndex]?.organizerItemId;
    let firstIndex = state.currentSlideIndex;
    while (firstIndex > 0 && slides[firstIndex - 1]?.organizerItemId === currentItemId) firstIndex--;
    nextIndex = firstIndex - 1;
  } else if (afterIndex < slides.length - 1) {
    nextIndex = afterIndex + 1;
  }

  stopImageSlideshowTimer({ resetProgress: true });
  if (nextIndex >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(nextIndex);
  }
  touch();
  ioRef.emit("state:update", getStateSnapshot());
  scheduleSave();
  if (nextIndex >= 0) scheduleRuntimeForCurrentSlide(ioRef);
}

function advanceImageSlideshowFrame(ioRef, scheduledSlideId) {
  const latestSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
  if (latestSlide?.id !== scheduledSlideId || latestSlide.type !== "imageSlideshow") return;

  const latestPlayable = getPlayableImageSlideshowEntries(latestSlide.organizerItemId);
  const latestPosition = latestPlayable.findIndex(({ index }) => index === state.currentSlideIndex);
  if (latestPlayable.length === 0 || latestPosition < 0) {
    advanceAfterImageSlideshow(ioRef);
    return;
  }

  if (latestPosition < latestPlayable.length - 1) {
    state.currentSlideIndex = getSafeSlideIndex(latestPlayable[latestPosition + 1].index);
  } else if (state.imageSlideshowLoopIteration < (Number(latestSlide.slideshowLoopCount) || 1)) {
    _imageSlideshowFailedUrls.clear();
    state.imageSlideshowLoopIteration += 1;
    state.currentSlideIndex = getSafeSlideIndex(latestPlayable[0].index);
  } else {
    advanceAfterImageSlideshow(ioRef);
    return;
  }

  touch();
  ioRef.emit("state:update", getStateSnapshot());
  scheduleSave();
  scheduleImageSlideshowSlide(ioRef);
}

function scheduleImageSlideshowSlide(ioRef, restoredEndsAt = null) {
  stopImageSlideshowTimer({ resetProgress: false });
  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];
  if (!currentSlide || currentSlide.type !== "imageSlideshow") return;

  const playable = getPlayableImageSlideshowEntries(currentSlide.organizerItemId);
  if (playable.length === 0) {
    state.imageSlideshowError = "This Image Slideshow has no valid playable images.";
    state.imageSlideshowEndsAt = null;
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    // Skip in the direction the operator was stepping so Prev can move past it.
    const direction = _manualNavigationDirection;
    _imageSlideshowTimer = setTimeout(() => {
      _imageSlideshowTimer = null;
      advanceAfterImageSlideshow(ioRef, { direction });
    }, 100);
    return;
  }

  let position = playable.findIndex(({ index }) => index === state.currentSlideIndex);
  if (position < 0) {
    state.currentSlideIndex = getSafeSlideIndex(playable[0].index);
    position = 0;
  }
  state.imageSlideshowError = null;
  state.moviePlaybackError = null;
  state.imageSlideshowLoopIteration = Math.max(
    1,
    Math.min(Number(currentSlide.slideshowLoopCount) || 1, Number(state.imageSlideshowLoopIteration) || 1)
  );
  const durationMs = normalizeSlideshowDurationSec(currentSlide.slideshowDurationSec) * 1000;
  const savedEndsAt = restoredEndsAt == null ? null : Number(restoredEndsAt);
  const imageSlideshowEndsAt = Number.isFinite(savedEndsAt) ? savedEndsAt : Date.now() + durationMs;
  if (imageSlideshowEndsAt <= Date.now()) {
    state.imageSlideshowEndsAt = null;
    advanceImageSlideshowFrame(ioRef, currentSlide.id);
    return;
  }
  state.imageSlideshowEndsAt = imageSlideshowEndsAt;
  touch();
  ioRef.emit("state:update", getStateSnapshot());

  const scheduledSlideId = playable[position].slide.id;
  _imageSlideshowTimer = setTimeout(() => {
    _imageSlideshowTimer = null;
    state.imageSlideshowEndsAt = null;
    advanceImageSlideshowFrame(ioRef, scheduledSlideId);
  }, Math.max(0, imageSlideshowEndsAt - Date.now()));
}

/**
 * Clear the pre-mass cycling timer and mark the slideshow as stopped.
 * Does NOT emit a state update — the caller is responsible for broadcasting.
 */
function stopPreMassTimer() {
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  _preMassDeadlineAt = null;
  _preMassDeadlineSlideId = null;
  state.preMassRunning = false;
}

function getAutomaticSlideDurationMs(slide) {
  const orgItem = state.organizerSequence.find((item) => item.id === slide?.organizerItemId);
  return Math.max(1000, (Number(orgItem?.durationSec) || 10) * 1000);
}

function keepPhaseDeadlineFromCurrentTime(deadlineAt, durationMs) {
  const now = Date.now();
  return deadlineAt < now - durationMs ? now + durationMs : deadlineAt;
}

function isPhaseOwnedSlide(slide) {
  return slide?.type === "imageSlideshow" ||
    slide?.type === "countdown" ||
    shouldMovieSlideControlAdvance(slide);
}

/**
 * Schedule the next pre-mass slide advance.
 * Reads durationSec from the current slide's organizer item.
 * Loops through all pre-mass slides indefinitely; the wall-clock scheduler
 * (scheduleStartTimer) will start gathering before mass and cut over to the
 * first Mass slide at mass time if massStartTime is set.
 */
function scheduleNextPreMassSlide(ioRef) {
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  if (!state.preMassRunning) {
    _preMassDeadlineAt = null;
    _preMassDeadlineSlideId = null;
    return;
  }

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "pre") {
    stopPreMassTimer();
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    return;
  }

  // Let controlled slide types own auto-advance and skip the phase timer.
  if (isPhaseOwnedSlide(currentSlide)) {
    _preMassDeadlineAt = null;
    _preMassDeadlineSlideId = null;
    if (currentSlide.type === "imageSlideshow") scheduleImageSlideshowSlide(ioRef);
    else if (currentSlide.type === "countdown") startCountdownForSlide(ioRef);
    else scheduleMovieAutoAdvance(ioRef, getAutomaticSlideDurationMs(currentSlide));
    return;
  }

  const durationMs = getAutomaticSlideDurationMs(currentSlide);
  if (_preMassDeadlineSlideId !== currentSlide.id || _preMassDeadlineAt == null) {
    _preMassDeadlineAt = Date.now() + durationMs;
    _preMassDeadlineSlideId = currentSlide.id;
  }
  const deadlineAt = keepPhaseDeadlineFromCurrentTime(_preMassDeadlineAt, durationMs);
  _preMassDeadlineAt = deadlineAt;

  _preMassTimer = setTimeout(() => {
    _preMassTimer = null;
    if (!state.preMassRunning) return;

    const allSlides = state.presentation?.slides || [];
    const preSlideIndices = getRunnablePhaseIndices("pre");

    if (preSlideIndices.length === 0) {
      stopPreMassTimer();
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      return;
    }

    const curPos = preSlideIndices.indexOf(state.currentSlideIndex);
    const nextPos = (curPos + 1) % preSlideIndices.length;
    const nextIndex = getSafeSlideIndex(preSlideIndices[nextPos]);
    const nextSlide = allSlides[nextIndex];
    state.currentSlideIndex = nextIndex;
    if (isPhaseOwnedSlide(nextSlide)) {
      _preMassDeadlineAt = null;
      _preMassDeadlineSlideId = null;
    } else {
      _preMassDeadlineAt = deadlineAt + getAutomaticSlideDurationMs(nextSlide);
      _preMassDeadlineSlideId = nextSlide?.id || null;
    }
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextPreMassSlide(ioRef);
  }, Math.max(0, deadlineAt - Date.now()));
}

/**
 * Clear the gathering timer and mark it as stopped.
 * Does NOT emit a state update — the caller is responsible for broadcasting.
 */
function stopGatheringTimer() {
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  _gatheringDeadlineAt = null;
  _gatheringDeadlineSlideId = null;
  state.gatheringRunning = false;
}

/**
 * Compute the total duration of all gathering slides in milliseconds.
 * Uses the same per-item calculation as the organizer list. An item with an
 * unknown length (a movie) adds no time.
 */
function getGatheringDurationMs() {
  const slides = state.presentation?.slides || [];
  let totalSec = 0;
  for (const item of state.organizerSequence) {
    if (item.phase !== "gathering") continue;
    const itemSlides = slides.filter((s) => s.organizerItemId === item.id);
    if (itemSlides.length === 0) continue;
    const playableCount = item.type === "imageSlideshow"
      ? itemSlides.filter(isPlayableImageSlideshowSlide).length
      : undefined;
    totalSec += itemRuntimeSeconds(item, state.manualSlides[item.id], itemSlides.length, playableCount) || 0;
  }
  return totalSec * 1000;
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
  stopPhaseOwnedTimers();

  const slides = state.presentation?.slides || [];
  const firstGatheringIdx = slides.findIndex((s) => s.phase === "gathering");
  const firstMassIdx = slides.findIndex((s) => s.phase === "mass");

  if (firstGatheringIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstGatheringIdx);
    state.gatheringRunning = true;
    _gatheringStartedForMassKey = state.massStartTime
      ? `${state.activeMassArchiveId || ""}|${state.massStartTime}`
      : null;
    updateInterstitialHoldResumeState();
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextGatheringSlide(ioRef);
  } else if (firstMassIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstMassIdx);
    updateInterstitialHoldResumeState();
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleRuntimeForCurrentSlide(ioRef);
  }
}

/**
 * Schedule the next gathering slide advance.
 * Unlike pre-mass, gathering does NOT loop — when the last gathering slide's
 * timer fires, it stops gathering and jumps to the first mass slide.
 */
function scheduleNextGatheringSlide(ioRef) {
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  if (!state.gatheringRunning) {
    _gatheringDeadlineAt = null;
    _gatheringDeadlineSlideId = null;
    return;
  }

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "gathering") {
    stopGatheringTimer();
    return;
  }

  // Let controlled slide types own auto-advance and skip the phase timer.
  if (isPhaseOwnedSlide(currentSlide)) {
    _gatheringDeadlineAt = null;
    _gatheringDeadlineSlideId = null;
    if (currentSlide.type === "imageSlideshow") scheduleImageSlideshowSlide(ioRef);
    else if (currentSlide.type === "countdown") startCountdownForSlide(ioRef);
    else scheduleMovieAutoAdvance(ioRef, getAutomaticSlideDurationMs(currentSlide));
    return;
  }

  const durationMs = getAutomaticSlideDurationMs(currentSlide);
  if (_gatheringDeadlineSlideId !== currentSlide.id || _gatheringDeadlineAt == null) {
    _gatheringDeadlineAt = Date.now() + durationMs;
    _gatheringDeadlineSlideId = currentSlide.id;
  }
  const deadlineAt = keepPhaseDeadlineFromCurrentTime(_gatheringDeadlineAt, durationMs);
  _gatheringDeadlineAt = deadlineAt;

  _gatheringTimer = setTimeout(() => {
    _gatheringTimer = null;
    if (!state.gatheringRunning) return;

    const allSlides = state.presentation?.slides || [];
    const gatheringIndices = allSlides.reduce((acc, s, i) => {
      if (s.phase === "gathering") acc.push(i);
      return acc;
    }, []);

    const current = allSlides[state.currentSlideIndex];
    if (!current || current.phase !== "gathering") {
      // The operator left gathering, usually by starting the Mass early.
      // A pending advance must not pull the projector back.
      stopGatheringTimer();
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      scheduleSave();
      return;
    }

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
      scheduleRuntimeForCurrentSlide(ioRef);
    } else {
      // Advance to the next gathering slide.
      const nextIndex = getSafeSlideIndex(gatheringIndices[curPos + 1]);
      const nextSlide = allSlides[nextIndex];
      state.currentSlideIndex = nextIndex;
      if (isPhaseOwnedSlide(nextSlide)) {
        _gatheringDeadlineAt = null;
        _gatheringDeadlineSlideId = null;
      } else {
        _gatheringDeadlineAt = deadlineAt + getAutomaticSlideDurationMs(nextSlide);
        _gatheringDeadlineSlideId = nextSlide?.id || null;
      }
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      scheduleSave();
      scheduleNextGatheringSlide(ioRef);
    }
  }, Math.max(0, deadlineAt - Date.now()));
}

// ── Post-mass slideshow automation ───────────────────────────────────────────
let _postMassTimer = null;
let _postMassDeadlineAt = null;
let _postMassDeadlineSlideId = null;

/**
 * Clear the post-mass cycling timer and mark the slideshow as stopped.
 */
function stopPostMassTimer() {
  if (_postMassTimer) { clearTimeout(_postMassTimer); _postMassTimer = null; }
  _postMassDeadlineAt = null;
  _postMassDeadlineSlideId = null;
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
  stopPhaseOwnedTimers();

  const slides = state.presentation?.slides || [];
  const firstPostIdx = slides.findIndex((s) => s.phase === "post");

  if (firstPostIdx >= 0) {
    state.currentSlideIndex = getSafeSlideIndex(firstPostIdx);
    state.postMassRunning = true;
    updateInterstitialHoldResumeState();
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
  if (!state.postMassRunning) {
    _postMassDeadlineAt = null;
    _postMassDeadlineSlideId = null;
    return;
  }

  const slides = state.presentation?.slides || [];
  const currentSlide = slides[state.currentSlideIndex];

  if (!currentSlide || currentSlide.phase !== "post") {
    stopPostMassTimer();
    return;
  }

  // Let controlled slide types own auto-advance and skip the phase timer.
  if (isPhaseOwnedSlide(currentSlide)) {
    _postMassDeadlineAt = null;
    _postMassDeadlineSlideId = null;
    if (currentSlide.type === "imageSlideshow") scheduleImageSlideshowSlide(ioRef);
    else if (currentSlide.type === "countdown") startCountdownForSlide(ioRef);
    else scheduleMovieAutoAdvance(ioRef, getAutomaticSlideDurationMs(currentSlide));
    return;
  }

  const durationMs = getAutomaticSlideDurationMs(currentSlide);
  if (_postMassDeadlineSlideId !== currentSlide.id || _postMassDeadlineAt == null) {
    _postMassDeadlineAt = Date.now() + durationMs;
    _postMassDeadlineSlideId = currentSlide.id;
  }
  const deadlineAt = keepPhaseDeadlineFromCurrentTime(_postMassDeadlineAt, durationMs);
  _postMassDeadlineAt = deadlineAt;

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
    const nextIndex = getSafeSlideIndex(postSlideIndices[nextPos]);
    const nextSlide = allSlides[nextIndex];
    state.currentSlideIndex = nextIndex;
    if (isPhaseOwnedSlide(nextSlide)) {
      _postMassDeadlineAt = null;
      _postMassDeadlineSlideId = null;
    } else {
      _postMassDeadlineAt = deadlineAt + getAutomaticSlideDurationMs(nextSlide);
      _postMassDeadlineSlideId = nextSlide?.id || null;
    }
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleNextPostMassSlide(ioRef);
  }, Math.max(0, deadlineAt - Date.now()));
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

function stopPhaseOwnedTimers() {
  stopCountdownTimer();
  stopImageSlideshowTimer({ resetProgress: true });
  stopMovieAutoAdvanceTimer();
}

function stopActiveSlideTimers() {
  stopPreMassTimer();
  stopGatheringTimer();
  stopPostMassTimer();
  stopPhaseOwnedTimers();
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

function updateInterstitialHoldResumeState() {
  if (!state.interstitialHoldActive) return;
  state.interstitialHoldReturnSlideIndex = state.currentSlideIndex;
  state.interstitialHoldResumeState = {
    preMassRunning: Boolean(state.preMassRunning),
    gatheringRunning: Boolean(state.gatheringRunning),
    postMassRunning: Boolean(state.postMassRunning)
  };
}

function stopAllRuntimeTimers() {
  clearStartTimers();
  if (_preMassTimer) { clearTimeout(_preMassTimer); _preMassTimer = null; }
  if (_gatheringTimer) { clearTimeout(_gatheringTimer); _gatheringTimer = null; }
  if (_postMassTimer) { clearTimeout(_postMassTimer); _postMassTimer = null; }
  _preMassDeadlineAt = null;
  _preMassDeadlineSlideId = null;
  _gatheringDeadlineAt = null;
  _gatheringDeadlineSlideId = null;
  _postMassDeadlineAt = null;
  _postMassDeadlineSlideId = null;
  if (_countdownTimer) { clearTimeout(_countdownTimer); _countdownTimer = null; }
  if (_imageSlideshowTimer) { clearTimeout(_imageSlideshowTimer); _imageSlideshowTimer = null; }
  stopMovieAutoAdvanceTimer();
  _movieEndGuard.reset();
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  state.preMassRunning = false;
  state.gatheringRunning = false;
  state.postMassRunning = false;
  state.countdownEndsAt = null;
  state.imageSlideshowEndsAt = null;
  state.imageSlideshowLoopIteration = 1;
  state.imageSlideshowError = null;
  clearInterstitialHoldState();
}

/**
 * Start the countdown for the current slide if it is a countdown type.
 * Sets countdownEndsAt so clients can render the visual timer, and schedules
 * auto-advance when time expires.
 */
function startCountdownForSlide(ioRef, restoredEndsAt = null) {
  stopCountdownTimer();
  const slides = state.presentation?.slides || [];
  const slide = slides[state.currentSlideIndex];
  if (!slide || slide.type !== "countdown") return;

  const seconds = Number(slide.countdownSec);
  // A missing or unusable length is not a countdown. Do not invent a timer.
  if (!Number.isFinite(seconds) || seconds < 1) {
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    return;
  }

  const durationMs = Math.min(COUNTDOWN_MAX_SEC * 1000, seconds * 1000);
  const savedEndsAt = restoredEndsAt == null ? null : Number(restoredEndsAt);
  const countdownEndsAt = Number.isFinite(savedEndsAt) ? savedEndsAt : Date.now() + durationMs;
  if (countdownEndsAt <= Date.now()) {
    state.countdownEndsAt = null;
    advanceFromCurrentSlide(ioRef);
    return;
  }
  state.countdownEndsAt = countdownEndsAt;
  // Broadcast immediately so clients can start rendering the countdown.
  touch();
  ioRef.emit("state:update", getStateSnapshot());

  const scheduledSlideId = slide.id;
  _countdownTimer = setTimeout(() => {
    _countdownTimer = null;
    state.countdownEndsAt = null;
    // A new Mass or a manual move supersedes this countdown; do not advance then.
    const latestSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
    if (latestSlide?.id !== scheduledSlideId || latestSlide.type !== "countdown") return;
    advanceFromCurrentSlide(ioRef);
  }, Math.max(0, countdownEndsAt - Date.now()));
}

function shouldMovieSlideControlAdvance(slide) {
  return Boolean(slide) &&
    slide.type === "movie" &&
    slide.videoLoop !== true &&
    slide.videoAutoAdvance !== false;
}

/**
 * Advance past a movie that auto-advances and owns its own timing, when the
 * phase timer deliberately steps aside for it. If no screen reports that the
 * video ended — a blocked autoplay, a missing file, a paused projector — the
 * liturgy would otherwise wait forever, so fall back to advancing when the
 * organizer item's duration elapses. A movie that loops stays on its slide.
 *
 * The duration is read when the slide starts; the fallback runs only while
 * that same slide is still current, so a manual or `slide:video-ended`
 * advance silently cancels it.
 */
function scheduleMovieAutoAdvance(ioRef, durationMs, { startedAt = null } = {}) {
  const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
  const playbackStartedAt = Number.isFinite(startedAt) ? startedAt : Date.now();
  stopMovieAutoAdvanceTimer();
  // A movie slide becoming current again (e.g. a looping pre-Mass sequence)
  // gets a fresh end report.
  _movieEndGuard.reset();
  if (!shouldMovieSlideControlAdvance(currentSlide)) return;

  _moviePlaybackStartedAt = playbackStartedAt;
  _moviePlaybackSlideId = currentSlide.id;
  const deadlineAt = playbackStartedAt + Math.max(1, Number(durationMs) || 0);

  _movieTimer = setTimeout(() => {
    _movieTimer = null;
    _moviePlaybackStartedAt = null;
    _moviePlaybackSlideId = null;
    // A different slide (manual move, video-ended, phase change) supersedes it.
    const current = (state.presentation?.slides || [])[state.currentSlideIndex];
    if (!shouldMovieSlideControlAdvance(current)) return;
    // Claim the end so a late `slide:video-ended` for this slide is ignored.
    _movieEndGuard.markHandled(state.currentSlideIndex, current.id);
    advanceFromCurrentSlide(ioRef);
  }, Math.max(0, deadlineAt - Date.now()));
}

function stopMovieAutoAdvanceTimer() {
  if (_movieTimer) { clearTimeout(_movieTimer); _movieTimer = null; }
  _moviePlaybackStartedAt = null;
  _moviePlaybackSlideId = null;
}

function clearMoviePlaybackError() {
  state.moviePlaybackError = null;
}

function getPhaseLoopNextIndex() {
  const phase = state.preMassRunning ? "pre" : state.postMassRunning ? "post" : null;
  if (!phase) return null;

  const indices = getRunnablePhaseIndices(phase);
  if (indices.length === 0) {
    if (phase === "pre") stopPreMassTimer();
    else stopPostMassTimer();
    return -1;
  }

  const currentPosition = indices.indexOf(state.currentSlideIndex);
  return getSafeSlideIndex(indices[(currentPosition + 1) % indices.length]);
}

function advanceFromCurrentSlide(ioRef) {
  const allSlides = state.presentation?.slides || [];
  const phaseLoopIndex = getPhaseLoopNextIndex();
  if (phaseLoopIndex !== null) {
    if (phaseLoopIndex < 0) {
      touch();
      ioRef.emit("state:update", getStateSnapshot());
      return false;
    }
    state.currentSlideIndex = phaseLoopIndex;
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    scheduleSave();
    scheduleRuntimeForCurrentSlide(ioRef);
    return true;
  }

  if (state.currentSlideIndex >= allSlides.length - 1) {
    touch();
    ioRef.emit("state:update", getStateSnapshot());
    return false;
  }

  state.currentSlideIndex = getSafeSlideIndex(state.currentSlideIndex + 1);
  touch();
  ioRef.emit("state:update", getStateSnapshot());
  scheduleSave();

  scheduleRuntimeForCurrentSlide(ioRef);
  return true;
}

/**
 * Stop whatever was advancing the liturgy and show the Mass.
 * Gathering often hands auto-advance to a countdown, slideshow, or movie
 * timer and then steps aside; those timers must be cleared too, or a
 * gathering countdown fires after the cutover and skips the first Mass slide.
 *
 * When the projector is already on a Mass slide, leave it there. The operator
 * may have started the entrance procession early. Otherwise jump to the first
 * Mass slide. No-op when the presentation has no Mass slides.
 */
function startMassSequence(ioRef) {
  const slides = state.presentation?.slides || [];
  const firstMassIdx = slides.findIndex((s) => s.phase === "mass");
  if (firstMassIdx < 0) return false;
  const alreadyOnMassSlide = slides[state.currentSlideIndex]?.phase === "mass";
  if (alreadyOnMassSlide) {
    stopPreMassTimer();
    stopGatheringTimer();
    stopPostMassTimer();
  } else {
    stopActiveSlideTimers();
  }
  if (!alreadyOnMassSlide) {
    state.currentSlideIndex = getSafeSlideIndex(firstMassIdx);
  }
  updateInterstitialHoldResumeState();
  touch();
  ioRef.emit("state:update", getStateSnapshot());
  scheduleSave();
  scheduleRuntimeForCurrentSlide(ioRef);
  return true;
}

/**
 * Schedule (or reschedule) the wall-clock automation for Mass:
 *  - a gathering lead-in timer that fires `gatheringMs` before Mass so all
 *    gathering slides can play through, and
 *  - a hard cutover timer at the scheduled time. It shows the first Mass
 *    slide when gathering overran or never started, and leaves the current
 *    slide when the operator is already in the Mass.
 *
 * If the gathering lead-in is already in the past, gathering starts
 * immediately, including when pre-Mass is still running and when an organizer
 * save is what made the lead-in past. A gathering sequence already playing
 * stays where it is. If Mass time is already past, catch-up shows the first
 * Mass slide, unless the projector is already on a Mass slide. `io` is passed
 * in because this runs in the server scope.
 * massStartTime must be a datetime-local string (YYYY-MM-DDTHH:MM).
 *
 * Pass `catchUp: false` when rescheduling after an edit that must not rewind a
 * Mass already underway (saving the organizer mid-Mass). Future timers are
 * still armed, and a lead-in that the edit itself pushed into the past still
 * starts gathering.
 */
function scheduleStartTimer(ioRef, { catchUp = true } = {}) {
  clearStartTimers();
  const timeStr = state.massStartTime;
  if (!timeStr) {
    _gatheringStartedForMassKey = null;
    return;
  }
  const massStartKey = `${state.activeMassArchiveId || ""}|${timeStr}`;
  const target = new Date(timeStr);
  if (isNaN(target.getTime())) return;
  const now = Date.now();
  const massStartAge = now - target.getTime();
  const massHasBegun = massStartAge >= 0 && massStartAge <= PHASE_LOOP_RESUME_MAX_AGE_MS;
  if (massStartAge > PHASE_LOOP_RESUME_MAX_AGE_MS) return;
  const onMassSlide = (state.presentation?.slides || [])[state.currentSlideIndex]?.phase === "mass";
  const onPostMassSlide = (state.presentation?.slides || [])[state.currentSlideIndex]?.phase === "post";

  // Arm the hard cutover at the scheduled time. It leaves a Mass slide that
  // is already showing, and otherwise opens the first Mass slide.
  if (!massHasBegun) {
    scheduleLongTimeout(target - now, () => {
      startMassSequence(ioRef);
    }, (handle) => { _massStartTimer = handle; });
  }

  const gatheringMs = getGatheringDurationMs();
  const msUntilGathering = (target - now) - gatheringMs;

  if (msUntilGathering > 0) {
    // Re-arming the lead-in would jump a gathering sequence already playing
    // back to its first slide.
    if (!state.gatheringRunning) {
      scheduleLongTimeout(msUntilGathering, () => {
        const slide = (state.presentation?.slides || [])[state.currentSlideIndex];
        if (slide?.phase === "mass") {
          // The operator already started the Mass. Do not open gathering over it.
          stopPreMassTimer();
          stopGatheringTimer();
          touch();
          ioRef.emit("state:update", getStateSnapshot());
          scheduleSave();
          return;
        }
        startGatheringSequence(ioRef);
      }, (handle) => { _startTimer = handle; });
    }
    return;
  }

  // The lead-in is already past. Once Mass has begun, only an explicit
  // catch-up may move the projector. Before that, open gathering even if
  // pre-Mass is still running. Leave a Mass slide, a gathering sequence
  // already playing, and a post-Mass slide or loop where they are.
  if (massHasBegun) {
    if (catchUp && !state.postMassRunning && !onPostMassSlide) startMassSequence(ioRef);
    return;
  }
  if (!state.gatheringRunning && !state.postMassRunning && !onMassSlide &&
      _gatheringStartedForMassKey !== massStartKey) {
    startGatheringSequence(ioRef);
  }
}

function rescheduleRuntimeTimers(ioRef) {
  scheduleStartTimer(ioRef);

  if (Number.isFinite(state.countdownEndsAt)) {
    startCountdownForSlide(ioRef, state.countdownEndsAt);
  }
  if (Number.isFinite(state.imageSlideshowEndsAt)) {
    scheduleImageSlideshowSlide(ioRef, state.imageSlideshowEndsAt);
  }
  if (state.preMassRunning) scheduleNextPreMassSlide(ioRef);
  if (state.gatheringRunning) scheduleNextGatheringSlide(ioRef);
  if (state.postMassRunning) scheduleNextPostMassSlide(ioRef);
}

function parseLocalDateTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const parsed = new Date(0);
  parsed.setHours(0, 0, 0, 0);
  parsed.setFullYear(year, month - 1, day);
  parsed.setHours(hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) return null;
  return parsed;
}

function isValidLocalDateTime(value) {
  return parseLocalDateTime(value) !== null;
}

function preMassStartIsBlocked() {
  const target = state.massStartTime ? new Date(state.massStartTime) : null;
  const massStartAge = target && !Number.isNaN(target.getTime()) ? Date.now() - target.getTime() : null;
  const massHasBegun = massStartAge !== null &&
    massStartAge >= 0 && massStartAge <= PHASE_LOOP_RESUME_MAX_AGE_MS;
  return Boolean(
    massHasBegun ||
    state.preMassRunning ||
    state.gatheringRunning ||
    state.postMassRunning
  );
}

function publicSaveError(label, error) {
  const message = String(error?.message || "unknown error")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]+/g, "[path]");
  return `Could not save ${label}: ${message}`;
}

function runScheduledSave() {
  _savePending = false;
  _saveTimer = null;
  const shouldSyncCurrentMass = _syncCurrentMassOnSave;
  try {
    // Save the Mass first: it sets activeMassArchiveId, which the session records.
    if (shouldSyncCurrentMass) {
      saveCurrentMass();
      _syncCurrentMassOnSave = false;
      _massSaveError = "";
    }
  } catch (error) {
    logError(`[persistence] Save failed: ${error.message}`);
    _massSaveError = publicSaveError("mass.json", error);
  }
  let sessionSaveError = "";
  try {
    if (saveSession(state) === false) {
      sessionSaveError = "Could not save session.json.";
    }
  } catch (error) {
    logError(`[persistence] Save failed: ${error.message}`);
    sessionSaveError = publicSaveError("session.json", error);
  }
  const saveError = _massSaveError || sessionSaveError;
  if (state.saveError !== saveError) {
    state.saveError = saveError;
    touch();
    activeIo?.emit("state:update", getStateSnapshot());
  }
}

/** Wait 600 ms after the last change before writing to disk. */
function scheduleSave(syncCurrentMass = false) {
  _syncCurrentMassOnSave = _syncCurrentMassOnSave || Boolean(syncCurrentMass);
  if (_savePending) return;
  _savePending = true;
  _saveTimer = setTimeout(runScheduledSave, 600);
}

/** Write a pending save now. Call this before the process exits. */
function flushPendingSave() {
  if (!_savePending) return;
  clearTimeout(_saveTimer);
  runScheduledSave();
}

/**
 * Clear the start PIN from the Electron operator menu.
 *
 * This path is intentionally not exposed through HTTP or Socket.IO.
 */
function resetStartPin() {
  const notifiedSockets = activeIo
    ? [...activeIo.sockets.sockets.values()].filter(socketHasControlSession)
    : [];
  state.startPin = "";
  state.startPinHash = null;
  clearControlAccess();
  for (const socket of notifiedSockets) {
    socket.data.controlToken = "";
    socket.emit("control:required", { error: "The start PIN was reset. Unlock again." });
  }
  touch();
  if (saveSession(state) === false) {
    throw new Error("Could not save session.json.");
  }
  activeIo?.emit("state:update", getStateSnapshot());
  return { ok: true, hasPin: false };
}

/**
 * Attempt to restore the last saved session.
 * Re-imports readings from the saved folder path if it still exists on disk.
 */
function restoreSession(ioRef) {
  const session = loadSession();
  if (!session) {
    logInfo(`[persistence] No saved session found at ${getSessionFilePath()}`);
  } else {
    logInfo(`[persistence] Restoring session saved at ${session.savedAt}`);

    const screenSettings = session.screenSettings || session.displaySettings;
    if (screenSettings && typeof screenSettings === "object") {
      state.screenSettings = normalizeScreenSettings(screenSettings);
    }

    if (session.massStartTime && typeof session.massStartTime === "string") {
      state.massStartTime = session.massStartTime;
    }

    if (Number.isInteger(session.organizerRevision) && session.organizerRevision >= 0) {
      state.organizerRevision = session.organizerRevision;
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

    state.controlMode = normalizeControlMode(session.controlMode);

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

    if (session.appSettings && typeof session.appSettings === "object") {
      if (!state.appSettings) state.appSettings = {};
      if (session.appSettings.theme && getTheme(session.appSettings.theme)) {
        state.appSettings.theme = session.appSettings.theme;
      }
      if (typeof session.appSettings.remoteAddress === "string") {
        state.appSettings.remoteAddress = session.appSettings.remoteAddress;
      }
      if (typeof session.appSettings.sourceNetworks === "string") {
        state.appSettings.sourceNetworks = session.appSettings.sourceNetworks;
      }
    }
  }

  const restored = restoreCurrentMassOrPrompt(ioRef, session?.activeMassArchiveId);
  if (restored) {
    if (Number.isFinite(session?.countdownEndsAt)) {
      state.countdownEndsAt = session.countdownEndsAt;
    }
    restoreSavedSlide(session);
    restoreDisplayOverrides(session);

    const savedAt = Date.parse(session?.savedAt || "");
    const savedAge = Date.now() - savedAt;
    const mayResumePhaseLoops = Number.isFinite(savedAt) &&
      savedAge >= 0 && savedAge <= PHASE_LOOP_RESUME_MAX_AGE_MS;
    const massStart = state.massStartTime ? new Date(state.massStartTime) : null;
    const massStartAge = massStart && !Number.isNaN(massStart.getTime())
      ? Date.now() - massStart.getTime()
      : null;
    const massHasBegun = massStartAge !== null &&
      massStartAge >= 0;

    if (mayResumePhaseLoops && session.preMassRunning && !massHasBegun) {
      state.preMassRunning = true;
      scheduleNextPreMassSlide(ioRef);
    }
    if (mayResumePhaseLoops && session.gatheringRunning && !massHasBegun) {
      state.gatheringRunning = true;
      scheduleNextGatheringSlide(ioRef);
    } else if (session.gatheringRunning && massHasBegun) {
      state.gatheringRunning = false;
    }
    if (mayResumePhaseLoops && session.postMassRunning) {
      state.postMassRunning = true;
      scheduleNextPostMassSlide(ioRef);
    }
  }
}

// ── Express / Socket.IO server ────────────────────────────────────────────────

function safeSocketHandler(socket, eventName, handler) {
  return (...args) => {
    try {
      const result = handler(...args);
      if (result && typeof result.then === "function") {
        return result.catch((error) => {
          logger.error(`[socket] ${eventName} failed: ${error.message || String(error)}`);
          return undefined;
        });
      }
      return result;
    } catch (error) {
      logger.error(`[socket] ${eventName} failed: ${error.message || String(error)}`);
      return undefined;
    }
  };
}

function startServer(port = 17841, options = {}) {
  // Defer session restore until after the server is listening.
  logger.setQuietLogs(options.quietLogs);
  let listeningPort = port;
  let runtimeTimerMonitor = null;
  let lastRuntimeClockAt = Date.now();

  function getLocalIpv4Address() {
    return getPreferredIpv4Address({ selectedAddress: state.appSettings?.remoteAddress });
  }

  const hostGuard = createHostGuard({
    getServerPort: () => listeningPort,
    onInvalidEntry: (entry) => logger.warn(`[security] Ignoring invalid ${ALLOWED_NETWORKS_ENV} entry: ${entry}`)
  });
  const sourceNetworkGuard = createSourceNetworkGuard({
    onInvalidEntry: (entry) => logger.warn(`[security] Ignoring invalid source network entry: ${entry}`)
  });

  const app = express();
  app.use(hostGuard.middleware);
  app.use(sourceNetworkGuard.middleware);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  const server = http.createServer(app);
  const io = new Server(server, {
    allowRequest: (req, callback) => {
      hostGuard.allowRequest(req, (error, hostAllowed) => {
        if (error || !hostAllowed) return callback(error, false);
        sourceNetworkGuard.allowRequest(req, callback);
      });
    }
  });
  activeIo = io;

  function endRemoteControlSessionsExcept(keepToken = "") {
    const notifiedSockets = [...io.sockets.sockets.values()].filter((socket) => {
      const token = getValidControlSessionToken(socket);
      return token && token !== keepToken;
    });
    clearControlAccessExcept(keepToken);
    for (const socket of notifiedSockets) {
      socket.data.controlToken = "";
      socket.emit("control:required", { error: "The operator ended remote sessions." });
    }
    return notifiedSockets.length;
  }

  function getSocketSourceAddress(socket) {
    return socket?.request?.socket?.remoteAddress
      || socket?.conn?.remoteAddress
      || socket?.handshake?.address
      || "";
  }

  function disconnectDisallowedSockets() {
    for (const socket of io.sockets.sockets.values()) {
      if (sourceNetworkGuard.isAllowedAddress(getSocketSourceAddress(socket))) continue;
      const token = getValidControlSessionToken(socket);
      if (token) clearControlSession(token);
      socket.data.controlToken = "";
      socket.disconnect(true);
    }
  }

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
  const builtinBackgroundRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many background list requests. Retry after the Retry-After header." }
  });
  const heavySocketRateLimit = createSocketRateLimitGuard({
    ...RATE_LIMIT_CONFIG.heavy,
    maxConcurrent: RATE_LIMIT_CONFIG.heavy.maxConcurrent
  });

  // Media reads (images, video ranges) are cheap static files. A page with many
  // slides would otherwise use the whole global budget and block the API.
  app.use("/api", (req, res, next) => {
    const isRead = req.method === "GET" || req.method === "HEAD";
    if (isRead && req.path.startsWith("/mass-asset/")) return next();
    return globalApiRateLimit(req, res, next);
  });
  app.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (req.path === "/verify-pin" || req.path === "/start-pin") return next();
    if (!clientMayControl(req)) {
      return res.status(401).json({ error: getUnlockMessage() });
    }
    return next();
  });

  // Pick the JSON limit by route so small routes never buffer upload-sized bodies.
  // This runs after the authorization check so unauthorized clients never cause buffering.
  const jsonParsers = new Map();
  function jsonParserFor(limit) {
    if (!jsonParsers.has(limit)) jsonParsers.set(limit, express.json({ limit }));
    return jsonParsers.get(limit);
  }
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const limit = JSON_BODY_LIMITS_BY_PATH.get(req.path) || JSON_BODY_LIMIT_DEFAULT;
    if (req.path !== "/api/import-mass-zip") {
      return jsonParserFor(limit)(req, res, next);
    }
    // Report an oversized ZIP request as HTTP 400 that names the limit and the size.
    return jsonParserFor(limit)(req, res, (error) => {
      if (error?.type === "entity.too.large") {
        return res.status(400).json({
          error: `Mass ZIP compressed size exceeds the ${MAX_MASS_ZIP_COMPRESSED_BYTES} byte limit. ` +
            `The request is ${error.length ? "" : "at least "}${error.length || error.received} bytes encoded.`
        });
      }
      return next(error);
    });
  });

  // Express cannot stream files from an Electron ASAR archive. Packaged builds
  // keep the public pages beside the archive so these routes work natively.
  const unpackedPublicDir = process.resourcesPath
    ? path.join(process.resourcesPath, "app.asar.unpacked", "public")
    : null;
  const publicDir = unpackedPublicDir && fs.existsSync(unpackedPublicDir)
    ? unpackedPublicDir
    : path.join(__dirname, "..", "public");
  const packagedBackgroundsDir = process.resourcesPath
    ? path.join(process.resourcesPath, "backgrounds")
    : null;
  const backgroundsDir = packagedBackgroundsDir && fs.existsSync(packagedBackgroundsDir)
    ? packagedBackgroundsDir
    : path.join(__dirname, "..", "backgrounds");
  app.use("/static/backgrounds", express.static(backgroundsDir, { index: false }));
  app.use("/static", (req, res, next) => {
    if (path.extname(req.path).toLowerCase() === ".html") {
      for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) res.setHeader(name, value);
    }
    return next();
  });
  app.use("/static", express.static(publicDir));

  function sendPublicPage(res, next, filename) {
    try {
      // Reading through Node's fs works both from source and inside an ASAR.
      const html = fs.readFileSync(path.join(publicDir, filename), "utf8");
      for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) res.setHeader(name, value);
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  }

  app.get("/", (_, res, next) => sendPublicPage(res, next, "app.html"));

  app.get("/app", (_, res, next) => sendPublicPage(res, next, "app.html"));

  app.get("/screen", (_, res, next) => sendPublicPage(res, next, "screen.html"));

  app.get("/remote", (_, res, next) => sendPublicPage(res, next, "remote.html"));

  app.get("/start", (_, res, next) => {
    // Skip straight to start-redirect when no PIN is configured.
    if (!hasPinConfigured()) return res.redirect("/api/start-redirect");
    return sendPublicPage(res, next, "start.html");
  });

  app.get("/api/state", (_, res) => {
    res.json(getCachedStateSnapshot(true));
  });

  function handleMassAssetUpload(req, res) {
    try {
      fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
      const body = req.body || {};
      if (!body.dataUrl) return res.status(400).json({ error: "dataUrl is required." });
      const upload = parseMassAssetUpload(body.filename, body.dataUrl);
      // Release the encoded request body before the file write and hash.
      body.dataUrl = null;
      const fileCountError = massAssetFileCountError(1);
      if (fileCountError) return res.status(400).json({ error: fileCountError });
      const sizeError = massAssetSizeError(upload.bytes.length);
      if (sizeError) return res.status(400).json({ error: sizeError });
      const asset = saveMassAssetUpload(upload);
      return res.json({
        ok: true,
        ...asset
      });
    } catch (error) {
      const status = error instanceof ValidationError ? 400 : 500;
      return res.status(status).json({ error: error.message || "Upload failed." });
    }
  }

  // Save Mass-owned assets into current_mass/assets/ so they travel with the package.
  app.post("/api/upload-mass-asset", uploadRateLimit, uploadConcurrentLimit, handleMassAssetUpload);

  // Keep a backward-compatible alias for legacy callers.
  app.post("/api/upload-image", uploadRateLimit, uploadConcurrentLimit, handleMassAssetUpload);

  // Import a directory's images in one bounded request so a large slideshow
  // does not exhaust the single-file upload rate limit.
  app.post("/api/import-slideshow-images", uploadRateLimit, uploadConcurrentLimit, (req, res) => {
    try {
      const images = Array.isArray(req.body?.images) ? req.body.images : [];
      if (images.length === 0) {
        return res.status(400).json({ error: "Choose one or more image files." });
      }
      if (images.length > MAX_SLIDESHOW_IMPORT_IMAGES) {
        return res.status(400).json({ error: `A slideshow can contain at most ${MAX_SLIDESHOW_IMPORT_IMAGES} images.` });
      }

      let totalBytes = 0;
      const uploads = [];
      const failed = [];
      for (const image of images) {
        try {
          const upload = parseMassAssetUpload(image?.filename, image?.dataUrl, IMAGE_ASSET_EXT);
          totalBytes += upload.bytes.length;
          uploads.push(upload);
        } catch (error) {
          failed.push({
            name: String(image?.filename || "Unnamed image"),
            error: error.message || "Image import failed."
          });
        }
      }
      if (uploads.length === 0) {
        return res.status(400).json({ error: failed[0]?.error || "Choose one or more image files." });
      }
      if (totalBytes > MAX_SLIDESHOW_IMPORT_BYTES) {
        return res.status(400).json({ error: "The selected images are too large to import together." });
      }
      const fileCountError = massAssetFileCountError(uploads.length);
      if (fileCountError) return res.status(400).json({ error: fileCountError });
      const sizeError = massAssetSizeError(totalBytes);
      if (sizeError) return res.status(400).json({ error: sizeError });

      fs.mkdirSync(CURRENT_MASS_DIR, { recursive: true });
      // Remove every file this request created if a later write fails, so a
      // retry does not leave orphaned copies of the failed batch.
      const imported = [];
      try {
        for (const upload of uploads) {
          imported.push(saveMassAssetUpload(upload));
        }
      } catch (error) {
        removeSavedMassAssets(imported);
        throw error;
      }
      return res.json({ ok: true, images: imported, failed });
    } catch (error) {
      const status = error instanceof ValidationError ? 400 : 500;
      return res.status(status).json({ error: error.message || "Image folder import failed." });
    }
  });

  // List images in current_mass/assets/ for the asset picker.
  app.get("/api/mass-assets", (req, res) => {
    try {
      const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
      if (!fs.existsSync(assetsDir)) {
        return res.json({ assets: [] });
      }
      const kind = String(req.query.kind || "all");
      const allowedExt = kind === "image"
        ? IMAGE_ASSET_EXT
        : kind === "video"
        ? VIDEO_ASSET_EXT
        : MEDIA_ASSET_EXT;
      const files = fs.readdirSync(assetsDir)
        .filter((f) => allowedExt.has(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      const assets = files.map((f) => ({
        name: f,
        url: assetUrlFromName(f),
        mediaType: VIDEO_ASSET_EXT.has(path.extname(f).toLowerCase()) ? "video" : "image"
      }));
      return res.json({ assets });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to list assets." });
    }
  });

  app.post("/api/remove-unused-mass-assets", (req, res) => {
    try {
      if (state.startupPrompt?.reason === "invalid-current-mass") {
        return res.status(409).json({ error: "No Mass is loaded." });
      }
      const result = removeUnusedMassAssets();
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to remove unused Mass assets." });
    }
  });

  app.get("/api/builtin-backgrounds", builtinBackgroundRateLimit, (_, res) => {
    try {
      if (!fs.existsSync(backgroundsDir)) return res.json({ assets: [] });
      const assets = fs.readdirSync(backgroundsDir)
        .filter((file) => IMAGE_ASSET_EXT.has(path.extname(file).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((file) => {
          const dimensions = file.match(/-(\d{3,4}x\d{3,4})(?=\.[^.]+$)/)?.[1] || "";
          const title = path.basename(file, path.extname(file))
            .replace(/^sacra_lux_/, "")
            .replace(/-\d{3,4}x\d{3,4}$/, "")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
          return {
            name: `${title}${dimensions ? ` (${dimensions})` : ""}`,
            url: `/static/backgrounds/${encodeURIComponent(file)}`
          };
        });
      return res.json({ assets });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to list built-in backgrounds." });
    }
  });

  app.post("/api/image-slideshow/preflight", async (req, res) => {
    try {
      const images = normalizeSlideshowImages(req.body?.images);
      const results = [];
      const hashes = new Map();
      const seenUrls = new Map();
      const sharp = require("sharp");

      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        const warnings = [];
        const withoutQuery = String(image.url || "").split(/[?#]/, 1)[0];
        const ext = path.extname(withoutQuery).toLowerCase();
        const filePath = slideshowAssetPathFromUrl(image.url);
        let hash = null;

        if (!image.url) {
          warnings.push("missing");
        } else if (!IMAGE_ASSET_EXT.has(ext)) {
          warnings.push("unsupported");
        } else if (filePath && !fs.existsSync(filePath)) {
          warnings.push("missing");
        } else if (filePath) {
          try {
            const bytes = fs.readFileSync(filePath);
            hash = crypto.createHash("sha256").update(bytes).digest("hex");
            await sharp(bytes).metadata();
          } catch (_error) {
            warnings.push("unreadable");
          }
        }

        if (image.url && seenUrls.has(image.url)) {
          warnings.push("duplicate");
          const firstIndex = seenUrls.get(image.url);
          if (!results[firstIndex].warnings.includes("duplicate")) results[firstIndex].warnings.push("duplicate");
        } else if (image.url) {
          seenUrls.set(image.url, index);
        }
        if (hash && hashes.has(hash)) {
          warnings.push("duplicate");
          const firstIndex = hashes.get(hash);
          if (!results[firstIndex].warnings.includes("duplicate")) results[firstIndex].warnings.push("duplicate");
        } else if (hash) {
          hashes.set(hash, index);
        }

        results.push({ index, url: image.url, name: image.name, valid: warnings.length === 0 || warnings.every((warning) => warning === "duplicate"), warnings });
      }

      const validCount = results.filter((result) => result.valid).length;
      return res.json({ ok: true, validCount, results });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Image Slideshow preflight failed." });
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
      for (const [name, value] of Object.entries(MASS_ASSET_SECURITY_HEADERS)) res.setHeader(name, value);
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
      const body = req.body || {};
      const urlError = screenSettingsUrlError(body);
      if (urlError) {
        return res.status(400).json({ error: urlError });
      }
      state.screenSettings = normalizeScreenSettings(body);
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
    for (const [id, t] of listThemeEntries()) {
      out[id] = { label: t.label, vars: t.vars, colorScheme: t.colorScheme || "light" };
    }
    res.json({ themes: out, current: state.appSettings?.theme || DEFAULT_THEME });
  });

  app.post("/api/app-settings", (req, res) => {
    try {
      const { theme, remoteAddress, sourceNetworks } = req.body || {};
      const nextSettings = {};
      let nextSourceNetworks;
      if (theme) {
        if (!listThemes().some((entry) => entry.id === theme)) {
          return res.status(400).json({ error: "Unknown theme." });
        }
        nextSettings.theme = theme;
      }
      if (remoteAddress !== undefined) {
        const validAddress = listIpv4Addresses().some((entry) => entry.address === remoteAddress);
        if (remoteAddress !== "" && !validAddress) {
          return res.status(400).json({ error: "The selected network address is not available." });
        }
        nextSettings.remoteAddress = remoteAddress;
      }
      if (sourceNetworks !== undefined) {
        if (typeof sourceNetworks !== "string") {
          return res.status(400).json({ error: "The source-network allowlist must be text." });
        }
        nextSourceNetworks = sourceNetworkGuard.parse(sourceNetworks);
        if (nextSourceNetworks.invalid.length) {
          return res.status(400).json({ error: `Invalid source network: ${nextSourceNetworks.invalid[0]}.` });
        }
        const clientAddress = String(req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || "")
          .replace(/^::ffff:/i, "");
        const clientFamily = net.isIP(clientAddress);
        if (
          nextSourceNetworks.entries.length &&
          !isLoopbackAddress(clientAddress) &&
          (!clientFamily || !nextSourceNetworks.networks.check(clientAddress, clientFamily === 4 ? "ipv4" : "ipv6"))
        ) {
          return res.status(400).json({ error: "The source-network allowlist must include the local operator address." });
        }
        nextSettings.sourceNetworks = sourceNetworks;
      }
      if (!state.appSettings) state.appSettings = {};
      Object.assign(state.appSettings, nextSettings);
      if (nextSourceNetworks) {
        sourceNetworkGuard.setAllowedEntries(sourceNetworks);
        disconnectDisallowedSockets();
        logger.info(`[security] Source-network restriction ${sourceNetworks.trim() ? "enabled" : "disabled"}.`);
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
      if (state.startupPrompt?.reason === "invalid-current-mass") {
        return res.status(409).json({ error: "No Mass is loaded." });
      }
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
        clearStartTimers();
      } else {
        if (!isValidLocalDateTime(time)) {
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

  // Sends the 429 answer and returns true while the client address is locked out.
  function rejectIfPinLocked(req, res) {
    const activeLock = getActiveLock(getClientIp(req));
    if (!activeLock) return false;
    const retryAfterSec = Math.max(1, Math.ceil((activeLock.lockUntil - Date.now()) / 1000));
    res.set("Retry-After", String(retryAfterSec));
    res.status(429).json({ error: "Too many failed attempts. Please try again later." });
    return true;
  }

  // ── Start PIN management ───────────────────────────────────────────────────
  app.post("/api/start-pin", authRateLimit, (req, res) => {
    try {
      const { pin, currentPin } = req.body || {};
      const clearing = pin === null || pin === undefined || pin === "";
      if (!hasPinConfigured() && !clientMayControl(req)) {
        return res.status(401).json({ error: getUnlockMessage() });
      }
      if (hasPinConfigured() && rejectIfPinLocked(req, res)) return undefined;
      if (hasPinConfigured() && !verifyPin(currentPin)) {
        registerPinFailure(getClientIp(req));
        return res.status(403).json({ error: "Current PIN is required." });
      }
      if (hasPinConfigured()) clearPinFailures(getClientIp(req));

      if (clearing) {
        state.startPin = "";
        state.startPinHash = null;
        clearControlAccess();
        touch();
        io.emit("state:update", getStateSnapshot());
        scheduleSave(true);
        return res.json({ ok: true, hasPin: false });
      }

      const cleaned = String(pin).replace(/\D/g, "").slice(0, 6);
      if (cleaned.length < 4) {
        return res.status(400).json({ error: "PIN must be 4–6 digits." });
      }
      const notifiedSockets = [...io.sockets.sockets.values()].filter(socketHasControlSession);
      state.startPinHash = createPinHashRecord(cleaned);
      state.startPin = "";
      clearControlAccess();
      for (const socket of notifiedSockets) {
        socket.data.controlToken = "";
        socket.emit("control:required", { error: "The PIN changed. Unlock again." });
      }
      const controlToken = noteControlUnlock(req);
      setControlCookie(res, controlToken);
      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);
      return res.json({ ok: true, hasPin: true, controlToken });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to set PIN." });
    }
  });

  app.post("/api/control-sessions/end", (req, res) => {
    if (!clientMayControl(req)) {
      return res.status(401).json({ error: getUnlockMessage() });
    }
    const keepToken = getValidControlSessionToken(req);
    const ended = endRemoteControlSessionsExcept(keepToken);
    return res.json({ ok: true, ended });
  });

  // ── Network control mode (used when no PIN is set) ─────────────────────────
  app.post("/api/control-mode", authRateLimit, (req, res) => {
    const mode = String(req.body?.mode || "");
    if (!CONTROL_MODES.includes(mode)) {
      return res.status(400).json({ error: "Mode must be unset or trusted-lan." });
    }
    state.controlMode = mode;
    touch();
    io.emit("state:update", getStateSnapshot());
    scheduleSave(true);
    return res.json({ ok: true, controlMode: state.controlMode });
  });

  // ── PIN verification ───────────────────────────────────────────────────────
  app.post("/api/verify-pin", authRateLimit, (req, res) => {
    try {
      const ip = getClientIp(req);
      if (rejectIfPinLocked(req, res)) return undefined;

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
      const controlToken = noteControlUnlock(req);
      setControlCookie(res, controlToken);
      return res.json({
        ok: true,
        redirect: `/api/start-redirect?token=${token}`,
        controlToken
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Verification failed." });
    }
  });

  app.post("/api/pre-mass/start", (req, res) => {
    try {
      if (preMassStartIsBlocked()) {
        return res.status(409).json({ error: "Mass is already in progress." });
      }
      const slides = state.presentation?.slides || [];
      const firstPreIdx = slides.findIndex((s) => s.phase === "pre");
      if (firstPreIdx < 0) {
        return res.status(400).json({ error: "No pre-mass slides found. Add slides with section 'Pre-Mass' first." });
      }
      stopGatheringTimer();
      stopPostMassTimer();
      state.currentSlideIndex = getSafeSlideIndex(firstPreIdx);
      state.preMassRunning = true;
      updateInterstitialHoldResumeState();
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
      stopPhaseOwnedTimers();
      updateInterstitialHoldResumeState();
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
      const providedToken = String(req.query.token || "");
      let startAuthorized = false;

      // Send the request to the PIN page when no valid token is present.
      if (hasPinConfigured()) {
        const ip = getClientIp(req);
        const tokenValid = isStartTokenValid({
          token: providedToken,
          ip,
          userAgent: req.get("user-agent") || ""
        });

        if (!tokenValid) {
          return res.redirect("/start");
        }
        const controlToken = noteControlUnlock(req);
        setControlCookie(res, controlToken);
        startAuthorized = true;
      }

      // Clear only this link so links for other phones stay valid.
      clearStartToken(providedToken);

      // A GET only finishes the QR entry flow. The remote page starts pre-Mass
      // with its normal authorized POST request after it loads.
      if (!startAuthorized && (hostGuard.isCrossSite(req) || !clientMayControl(req))) return res.redirect("/remote");
      return res.redirect(preMassStartIsBlocked() ? "/remote" : "/remote#start-pre-mass");
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
    stopPhaseOwnedTimers();
    updateInterstitialHoldResumeState();
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
    stopPhaseOwnedTimers();
    updateInterstitialHoldResumeState();
    touch();
    io.emit("state:update", getStateSnapshot());
    scheduleSave();
    return res.json({ ok: true });
  });

  app.get("/api/export-settings", (req, res) => {
    try {
      // Local filesystem paths go only to clients that may control the Mass.
      const mayControl = clientMayControl(req);
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        presentationTitle: state.presentation?.title || null,
        massStartTime: state.massStartTime || null,
        screenSettings: state.screenSettings,
        organizerSequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        lastReadingsFolderPath: mayControl ? state.readingsSource?.folderPath || null : null
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
      const urlError = screenSettingsUrlError(payload.screenSettings) || manualSlideUrlError(payload.manualSlides);
      if (urlError) {
        return res.status(400).json({ error: urlError });
      }
      const nextScreenSettings = payload.screenSettings && typeof payload.screenSettings === "object"
        ? normalizeScreenSettings(payload.screenSettings)
        : state.screenSettings;
      const nextOrganizerSequence = Array.isArray(payload.organizerSequence)
        ? normalizeOrganizerSequence(payload.organizerSequence)
        : state.organizerSequence;
      const nextManualSlides = payload.manualSlides && typeof payload.manualSlides === "object"
        ? mergeManualSlideState(nextOrganizerSequence, payload.manualSlides)
        : state.manualSlides;
      if (payload.massStartTime !== undefined && payload.massStartTime !== null && payload.massStartTime !== "" &&
        !isValidLocalDateTime(payload.massStartTime)) {
        throw new ValidationError("massStartTime must be a valid datetime string.");
      }

      if (payload.screenSettings && typeof payload.screenSettings === "object") {
        state.screenSettings = nextScreenSettings;
      }
      if (Array.isArray(payload.organizerSequence)) {
        state.organizerSequence = nextOrganizerSequence;
      }
      if (payload.manualSlides && typeof payload.manualSlides === "object") {
        state.manualSlides = nextManualSlides;
        propagateInterstitialImage(state.organizerSequence, state.manualSlides);
      }
      if (Array.isArray(payload.organizerSequence) || (payload.manualSlides && typeof payload.manualSlides === "object")) {
        state.organizerRevision += 1;
      }
      repaginateReadingSlidesIfNeeded();
      // Readings rebuild the slides above. A sequence with no readings still
      // has to be built before the wall clock measures gathering.
      if (
        (!Array.isArray(state.readingsSource?.documents) || state.readingsSource.documents.length === 0) &&
        (Array.isArray(payload.organizerSequence) || (payload.manualSlides && typeof payload.manualSlides === "object"))
      ) {
        rebuildPresentationFromOrganizer({
          title: state.presentation?.title || "Mass Presentation",
          documents: [],
          sequence: state.organizerSequence,
          manualSlides: state.manualSlides,
          screenSettings: state.screenSettings
        });
      }
      if (payload.presentationTitle && state.presentation) {
        state.presentation.title = String(payload.presentationTitle);
      }
      if (payload.massStartTime !== undefined && payload.massStartTime !== null && payload.massStartTime !== "") {
        state.massStartTime = payload.massStartTime;
        scheduleStartTimer(io);
      } else if (payload.massStartTime === null || payload.massStartTime === "") {
        state.massStartTime = null;
        clearStartTimers();
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
  app.get("/api/export-mass-zip", heavyRateLimit, async (req, res) => {
    if (!clientHasControlSession(req)) {
      return res.status(401).json({ error: "Unlock required." });
    }
    try {
      if (!saveCurrentMass() || !fs.existsSync(path.join(CURRENT_MASS_DIR, "mass.json"))) {
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
  const MAX_AVIF_DOWNLOAD_TOKENS = 3;

  function releaseAvifDownloadToken(token) {
    const entry = avifDownloadTokens.get(token);
    if (!entry) return;
    clearTimeout(entry.expiryTimer);
    avifDownloadTokens.delete(token);
  }

  function storeAvifDownloadToken(token, entry) {
    if (entry.controlToken) {
      for (const [existingToken, existingEntry] of avifDownloadTokens) {
        if (existingEntry.controlToken === entry.controlToken) {
          releaseAvifDownloadToken(existingToken);
        }
      }
    }
    while (avifDownloadTokens.size >= MAX_AVIF_DOWNLOAD_TOKENS) {
      const oldestToken = avifDownloadTokens.keys().next().value;
      releaseAvifDownloadToken(oldestToken);
    }
    avifDownloadTokens.set(token, entry);
  }

  app.get("/api/export-mass-zip-avif", heavyRateLimit, (req, res) => {
    if (!clientHasControlSession(req)) {
      return res.status(401).json({ error: "Unlock required." });
    }
    const token = req.query.token;
    const entry = token && avifDownloadTokens.get(token);
    if (!entry) return res.status(404).json({ error: "Invalid or expired download token." });
    if (entry.controlToken && getValidControlSessionToken(req) !== entry.controlToken) {
      return res.status(401).json({ error: "Unlock required." });
    }
    releaseAvifDownloadToken(token);
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

      // Validate the start time before archiving or mutating any live state, so
      // an unparseable value is rejected without changing the current Mass.
      let scheduledStart = null;
      if (startTime) {
        if (!isValidLocalDateTime(startTime)) {
          return res.status(400).json({ error: "startTime must be a valid datetime (YYYY-MM-DDTHH:MM) or empty." });
        }
        scheduledStart = String(startTime);
      }

      const hasArchivableContent = state.organizerSequence.length > 0 ||
        (state.presentation?.title && state.presentation.title !== "No presentation loaded");
      let archivedMassId = null;
      if (hasArchivableContent) {
        saveCurrentMass();
        archivedMassId = state.activeMassArchiveId || null;
      } else {
        preserveInvalidCurrentMass();
      }

      // 2. Apply new title
      state.activeMassArchiveId = null;
      state.startupPrompt = null;
      state.presentation.title = String(title).trim();
      state.organizerRevision += 1;

      // 3. Reset playback, then arm the clock from the slides this Mass already has.
      state.currentSlideIndex = 0;
      resetDisplayOverrides();
      stopActiveSlideTimers();
      resetPlaybackErrors();
      if (scheduledStart) {
        state.massStartTime = scheduledStart;
        scheduleStartTimer(io);
      } else {
        state.massStartTime = null;
        clearStartTimers();
      }

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
  app.post("/api/new-mass", heavyRateLimit, async (req, res) => {
    try {
      const { title, startTime, useLectionaryRss } = req.body || {};

      // Validate the start time before fetching, archiving, or mutating any
      // live state, so an unparseable value is rejected without changing the
      // current Mass.
      let scheduledStart = null;
      if (startTime) {
        if (!isValidLocalDateTime(startTime)) {
          return res.status(400).json({ error: "startTime must be a valid datetime (YYYY-MM-DDTHH:MM) or empty." });
        }
        scheduledStart = String(startTime);
      }

      let massTitle = String(title || "").trim();
      let lectionaryDocuments = [];
      if (useLectionaryRss) {
        const lectionary = await fetchUsccbDailyReadings();
        massTitle = massTitle || lectionary.title;
        lectionaryDocuments = lectionary.documents;
      }
      if (!massTitle) {
        return res.status(400).json({ error: "title is required." });
      }

      // 1. Archive current mass if it has content
      let archivedMassId = null;
      const hasContent = state.organizerSequence.length > 0 ||
        (state.presentation?.title && state.presentation.title !== "No presentation loaded");
      if (hasContent) {
        saveCurrentMass();
        archivedMassId = state.activeMassArchiveId || null;
      } else {
        preserveInvalidCurrentMass();
      }

      // 2. Remove Mass-owned media only after the prior Mass archive succeeds.
      const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
      fs.rmSync(assetsDir, { recursive: true, force: true });
      fs.mkdirSync(assetsDir, { recursive: true });
      for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
        if (String(state.screenSettings[key] || "").startsWith("/api/mass-asset/")) {
          state.screenSettings[key] = DEFAULT_SCREEN_SETTINGS[key];
        }
      }

      // 3. Build a default organizer sequence with placeholder slides
      state.activeMassArchiveId = null;
      state.startupPrompt = null;
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
      if (!useLectionaryRss) {
        const defaultReadingDocuments = state.organizerSequence
          .filter((item) => item.type === "reading")
          .map((item) => {
            item.sourceStem = item.id;
            return {
              stem: item.sourceStem,
              section: item.label,
              passage: item.label,
              textLines: []
            };
          });
        syncReadingsDocumentsToCurrentMass(defaultReadingDocuments, massTitle);
        lectionaryDocuments = alignReadingDocumentsWithOrganizer(
          loadReadingsFromFolder(CURRENT_MASS_DIR, state.screenSettings),
          state.organizerSequence
        );
      }
      if (useLectionaryRss) {
        const documentsBySection = new Map();
        for (const document of lectionaryDocuments) {
          if (!documentsBySection.has(document.section)) {
            documentsBySection.set(document.section, document);
          }
        }
        const readingSlots = new Map([
          ["mass-reading-1", "Reading I"],
          ["mass-psalm", "Responsorial Psalm"],
          ["mass-reading-2", "Reading II"],
          ["mass-gospel", "Gospel"]
        ]);
        const verseBeforeGospel = documentsBySection.get("Verse Before the Gospel");
        state.organizerSequence = state.organizerSequence.map((item) => {
          const document = documentsBySection.get(readingSlots.get(item.id));
          if (document) return { ...item, sourceStem: document.stem };
          if (item.id === "mass-gospel-acclamation" && verseBeforeGospel) {
            return {
              ...item,
              type: "reading",
              sourceStem: verseBeforeGospel.stem
            };
          }
          return item;
        });
        const emptyReadingIds = new Set(
          state.organizerSequence
            .filter((item) => item.type === "reading" && !item.sourceStem)
            .map((item) => item.id)
        );
        for (const itemId of emptyReadingIds) {
          const readingIndex = state.organizerSequence.findIndex((item) => item.id === itemId);
          if (readingIndex < 0) continue;
          state.organizerSequence.splice(readingIndex, 1);
          const nextItem = state.organizerSequence[readingIndex];
          if (nextItem?.type === "interstitial") {
            state.organizerSequence.splice(readingIndex, 1);
          } else if (state.organizerSequence[readingIndex - 1]?.type === "interstitial") {
            state.organizerSequence.splice(readingIndex - 1, 1);
          }
        }
      }
      const newManualSlides = {};
      for (const item of state.organizerSequence) {
        if (item.type === "text" || item.type === "prayer" || item.type === "hymn") {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: "middle", imageUrl: null };
        } else if (item.type === "countdown") {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: null, imageUrl: null, countdownSec: 30, countdownFont: "", countdownStyle: "ring", countdownSizePercent: 100 };
        } else {
          newManualSlides[item.id] = { text: "", notes: "", textVAlign: null, imageUrl: null };
        }
      }
      state.manualSlides = newManualSlides;
      state.organizerRevision += 1;

      // 4. Set title, clear readings, and reset playback
      state.presentation.title = massTitle;
      state.presentation.sourceFile = null;
      state.readingsSource = {
        folderPath: CURRENT_MASS_DIR,
        documents: lectionaryDocuments
      };
      state.currentSlideIndex = 0;
      resetDisplayOverrides();
      stopActiveSlideTimers();
      resetPlaybackErrors();

      // 5. Build the slides, then arm the wall clock from this Mass's gathering length.
      state.presentation = buildPresentationFromOrganizer({
        title: state.presentation.title,
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });
      if (scheduledStart) {
        state.massStartTime = scheduledStart;
        scheduleStartTimer(io);
      } else {
        state.massStartTime = null;
        clearStartTimers();
      }

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({
        ok: true,
        archivedMassId,
        title: state.presentation.title,
        massStartTime: state.massStartTime,
        organizerCount: state.organizerSequence.length,
        slideCount: state.presentation.slides.length,
        lectionaryReadingsImported: Boolean(useLectionaryRss)
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
      // eslint-disable-next-line security/detect-unsafe-regex -- no nested quantifier; the pattern is anchored and linear
      const match = String(zipData).match(/^(?:data:[^;]+;base64,)?([A-Za-z0-9+/=\s]+)$/);
      if (!match) {
        return res.status(400).json({ error: "Invalid zip data." });
      }
      const encodedZip = match[1].replace(/\s/g, "");
      const maxEncodedZipLength = Math.ceil(MAX_MASS_ZIP_COMPRESSED_BYTES / 3) * 4;
      if (encodedZip.length > maxEncodedZipLength) {
        throw new ValidationError(
          `Mass ZIP compressed size exceeds the ${MAX_MASS_ZIP_COMPRESSED_BYTES} byte limit.`
        );
      }
      const zipBuf = Buffer.from(encodedZip, "base64");
      if (zipBuf.length > MAX_MASS_ZIP_COMPRESSED_BYTES) {
        throw new ValidationError(
          `Mass ZIP compressed size exceeds the ${MAX_MASS_ZIP_COMPRESSED_BYTES} byte limit.`
        );
      }
      const zip = new (getAdmZip())(zipBuf);
      validateMassZipArchive(zip, zipBuf.length);

      const massEntry = zip.getEntry("mass.json");
      const settingsEntry = zip.getEntry("settings.json");
      const definitionEntry = massEntry || settingsEntry;
      if (!definitionEntry) {
        return res.status(400).json({ error: "ZIP does not contain mass.json or settings.json." });
      }
      const packageDefinition = parseMassZipDefinition(definitionEntry);
      validateMassPackageDefinition(packageDefinition, state.screenSettings);
      const missingMedia = findMissingMassAssets(packageDefinition, { kind: "zip", zip });

      saveCurrentMass();
      preserveInvalidCurrentMass();
      replaceCurrentMassDir((stagingDir) => {
        writeZipMassPackage(zip, stagingDir, packageDefinition);
      });

      state.activeMassArchiveId = null;
      applyMassPackageFromCurrentDir(io, packageDefinition);
      scheduleSave(true);
      return res.json({ ok: true, slideCount: state.presentation.slides.length, missingMedia });
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

      let packageData = null;
      let missingMedia = [];
      if (fs.existsSync(archivePaths.packageDir)) {
        const massJsonPath = path.join(archivePaths.packageDir, "mass.json");
        if (!fs.existsSync(massJsonPath)) {
          return res.status(400).json({ error: "Archive package is missing mass.json." });
        }
        try {
          packageData = JSON.parse(fs.readFileSync(massJsonPath, "utf8"));
        } catch {
          return res.status(400).json({ error: "Archive package is missing mass.json." });
        }
        validateMassPackageDefinition(packageData, state.screenSettings);
        missingMedia = findMissingMassAssets(packageData, { kind: "folder", root: archivePaths.packageDir });
        saveCurrentMass();
        preserveInvalidCurrentMass();
        replaceCurrentMassDir((stagingDir) => {
          fs.cpSync(archivePaths.packageDir, stagingDir, { recursive: true });
          readMassPackageDefinition(stagingDir, state.screenSettings);
        });
      } else if (fs.existsSync(archivePaths.compressedZipPath)) {
        const zipBuffer = fs.readFileSync(archivePaths.compressedZipPath);
        const zip = new (getAdmZip())(zipBuffer);
        const massEntry = zip.getEntry("mass.json");
        const settingsEntry = zip.getEntry("settings.json");
        const definitionEntry = massEntry || settingsEntry;
        if (!definitionEntry) {
          return res.status(400).json({ error: "Compressed archive is missing mass.json or settings.json." });
        }
        try {
          packageData = JSON.parse(definitionEntry.getData().toString("utf8"));
          if (packageData?.format !== "sacra-lux.mass") packageData = rewriteLegacyUploadRefs(packageData);
        } catch {
          return res.status(400).json({ error: "Compressed archive is missing mass.json or settings.json." });
        }
        validateMassPackageDefinition(packageData, state.screenSettings);
        missingMedia = findMissingMassAssets(packageData, { kind: "zip", zip });
        saveCurrentMass();
        preserveInvalidCurrentMass();
        replaceCurrentMassDir((stagingDir) => {
          writeZipMassPackage(zip, stagingDir, packageData);
        });
      } else {
        return res.status(400).json({ error: "Mass archive has no loadable package." });
      }

      state.activeMassArchiveId = archiveId;
      applyMassPackageFromCurrentDir(io, packageData);
      scheduleSave(true);
      return res.json({ ok: true, activeArchiveId: archiveId, title: state.presentation?.title || null, missingMedia });
    } catch (error) {
      return sendApiError(res, error, "Failed to load Mass archive.");
    }
  });

  app.post("/api/mass-history/:archiveId/compress", heavyRateLimit, async (req, res) => {
    try {
      const archivePaths = getArchivePaths(path.basename(String(req.params.archiveId || "")));
      const { archiveId } = archivePaths;
      if (archiveIdsEqual(archiveId, state.activeMassArchiveId)) {
        return res.status(400).json({ error: "The active Mass cannot be compressed." });
      }
      if (!fs.existsSync(archivePaths.packageDir)) {
        return res.status(404).json({ error: "Mass archive package not found." });
      }
      const zipBuffer = await buildMassZipFromPackage(archivePaths.packageDir, { avif: true });
      const zip = new (getAdmZip())(zipBuffer);
      validateMassZipArchive(zip, zipBuffer.length);
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
      return sendApiError(res, error, "Failed to compress Mass archive.");
    }
  });

  app.delete("/api/mass-history/:archiveId", (req, res) => {
    try {
      const { archiveId } = getArchivePaths(path.basename(String(req.params.archiveId || "")));
      if (archiveIdsEqual(archiveId, state.activeMassArchiveId)) {
        return res.status(400).json({ error: "The active Mass archive cannot be deleted." });
      }
      const deleted = deleteMassArchive(archiveId);
      if (!deleted) {
        return res.status(404).json({ error: "Mass archive not found." });
      }
      return res.json({ ok: true, archiveId });
    } catch (error) {
      return sendApiError(res, error, "Failed to delete Mass archive.");
    }
  });

  app.post("/api/organizer", (req, res) => {
    try {
      const { sequence, manualSlides, organizerRevision } = req.body || {};
      if (!Array.isArray(sequence)) {
        return res.status(400).json({ error: "sequence array is required." });
      }

      if (organizerRevision !== undefined && organizerRevision !== state.organizerRevision) {
        return res.status(409).json({
          error: "Another organizer change was saved first. Reload the current state and try again.",
          organizerRevision: state.organizerRevision
        });
      }

      const urlError = manualSlideUrlError(manualSlides);
      if (urlError) {
        return res.status(400).json({ error: urlError });
      }

      for (const manual of Object.values(manualSlides && typeof manualSlides === "object" ? manualSlides : {})) {
        const countdownError = countdownSecError(manual?.countdownSec);
        if (countdownError) {
          return res.status(400).json({ error: countdownError });
        }
      }

      const nextOrganizerSequence = normalizeOrganizerSequence(sequence);
      const nextManualSlides = mergeManualSlideState(nextOrganizerSequence, manualSlides || {});
      const nextPresentation = buildPresentationFromOrganizer({
        title: state.presentation.title,
        documents: state.readingsSource.documents,
        sequence: nextOrganizerSequence,
        manualSlides: nextManualSlides,
        screenSettings: state.screenSettings
      });
      buildValidatedMassDocument({
        ...state,
        presentation: nextPresentation,
        organizerSequence: nextOrganizerSequence,
        manualSlides: nextManualSlides
      });
      preserveInvalidCurrentMass();
      _manualNavigationDirection = 1;
      state.startupPrompt = null;
      const previousSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
      const wasSlideshow = previousSlide?.type === "imageSlideshow";
      stopImageSlideshowTimer({ resetProgress: false, clearError: true });
      _imageSlideshowFailedUrls.clear();
      state.organizerSequence = nextOrganizerSequence;
      state.manualSlides = nextManualSlides;
      state.organizerRevision += 1;
      propagateInterstitialImage(state.organizerSequence, state.manualSlides);
      // Always rebuild the presentation so manual content stays current.
      rebuildPresentationFromOrganizer({
        title: state.presentation.title,
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });
      const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
      const sameSlideshow = wasSlideshow && currentSlide?.type === "imageSlideshow" &&
        currentSlide.organizerItemId === previousSlide.organizerItemId;
      if (!sameSlideshow) state.imageSlideshowLoopIteration = 1;
      if (currentSlide?.type === "imageSlideshow") {
        scheduleImageSlideshowSlide(io);
      } else if (wasSlideshow || state.preMassRunning || state.gatheringRunning || state.postMassRunning) {
        // The organizer save changed the current slide; hand control back to the phase loop.
        scheduleRuntimeForCurrentSlide(io);
      }
      // Reschedule because gathering durations may have changed. A Mass already
      // underway stays where it is. A lead-in this save pushes into the past
      // still starts gathering.
      scheduleStartTimer(io, { catchUp: false });
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
        documents: alignReadingDocumentsWithOrganizer(imported.documents || [], state.organizerSequence)
      };

      rebuildPresentationFromOrganizer({
        title: state.presentation?.title || imported.title || "Mass Presentation",
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
        totalSlides: state.presentation.slides.length
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || "Failed to reload mass folder." });
    }
  });

  app.post("/api/preview-reading", (req, res) => {
    try {
      const { text, stem, label, overrideSettings, styleOverrides, passage } = req.body || {};
      if (typeof text === "string" && text.length > MAX_PREVIEW_TEXT_CHARACTERS) {
        return res.status(400).json({ error: "Preview text must not exceed 100,000 characters." });
      }

      // Without a stem, preview a sample reading so the Text Area tool can
      // show real slides before a Mass folder loads.
      const doc = stem
        ? state.readingsSource?.documents?.find((d) => d.stem === stem)
        : { stem: "preview:sample", section: "", passage: String(passage || "").trim(), ending: "" };
      if (!doc) {
        return res.status(404).json({ error: "Reading not found in loaded documents." });
      }

      const previewDoc = {
        stem: doc.stem,
        section: doc.section,
        passage: doc.passage,
        textLines: (text || "").split(/\r?\n/),
        ending: doc.ending
      };

      // Build the slides with the same organizer path as the projector so the
      // preview shows the same page breaks.
      const presentation = buildPresentationFromOrganizer({
        title: "Preview",
        documents: [previewDoc],
        sequence: [{
          id: "preview:reading",
          type: "reading",
          sourceStem: previewDoc.stem,
          label: String(label || doc.section || ""),
          styleOverrides,
          psalmRefrainIndex: req.body?.psalmRefrainIndex
        }],
        manualSlides: {},
        // Normalize so draft text bounds also update the geometry fields that
        // the paginator reads.
        screenSettings: overrideSettings && typeof overrideSettings === "object"
          ? normalizeScreenSettings({ ...state.screenSettings, ...overrideSettings })
          : state.screenSettings
      });

      return res.json({ ok: true, slides: presentation.slides || [] });
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
      manual.styleOverrides = normalizeStyleOverrides(incomingManual.styleOverrides);
      if (type === "imageSlideshow") {
        manual.images = normalizeSlideshowImages(incomingManual.images);
        manual.slideshowDurationSec = normalizeSlideshowDurationSec(incomingManual.slideshowDurationSec);
        manual.slideshowLoopCount = normalizeSlideshowLoopCount(incomingManual.slideshowLoopCount);
      }
      if (["top", "middle", "bottom"].includes(String(incomingManual.textVAlign || ""))) {
        manual.textVAlign = String(incomingManual.textVAlign);
      }
      if (type === "countdown") {
        const countdownError = countdownSecError(incomingManual.countdownSec);
        if (countdownError) {
          return res.status(400).json({ error: countdownError });
        }
        manual.countdownSec = normalizeCountdownSec(incomingManual.countdownSec);
        manual.countdownFont = normalizeCountdownFont(incomingManual.countdownFont);
        manual.countdownStyle = normalizeCountdownStyle(String(incomingManual.countdownStyle || ""));
        manual.countdownSizePercent = normalizeCountdownSizePercent(incomingManual.countdownSizePercent);
      }

      const presentation = buildPresentationFromOrganizer({
        title: "Preview",
        documents: state.readingsSource?.documents || [],
        sequence,
        manualSlides: { [organizerId]: manual },
        // Draft settings let the settings preview repaginate before a save.
        screenSettings: payload.overrideSettings && typeof payload.overrideSettings === "object"
          ? normalizeScreenSettings({ ...state.screenSettings, ...payload.overrideSettings })
          : state.screenSettings
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
      if (typeof text !== "string") {
        return res.status(400).json({ error: "Reading text must be a string." });
      }

      const filePath = resolveReadingTxtInMass(folderPath, stem);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Reading file not found." });
      }

      const fileContent = fs.readFileSync(filePath, "utf8");
      const lines = fileContent.split(/\r?\n/);
      const passageIndex = lines.findIndex((line) => line.trim() !== "");
      let textStart = passageIndex < 0 ? lines.length : passageIndex + 1;
      while (textStart < lines.length && lines[textStart].trim() === "") {
        textStart++;
      }

      const headerLines = passageIndex < 0
        ? []
        : [lines[passageIndex], ...lines.slice(passageIndex + 1, textStart)];
      const newContent = headerLines.join("\n") + "\n" + text;

      writeFileAtomic(filePath, newContent);

      const imported = importReadings(folderPath, {
        fontSizePx: state.screenSettings.fontSizePx,
        fontFamily: state.screenSettings.fontFamily,
        readingTextHeightPx: state.screenSettings.readingTextHeightPx
      });

      state.readingsSource = {
        folderPath: imported.folderPath,
        documents: alignReadingDocumentsWithOrganizer(imported.documents || [], state.organizerSequence)
      };

      // The live title wins: mass_title.txt on disk can lag behind it by the save delay.
      const liveTitle = state.presentation?.title;
      rebuildPresentationFromOrganizer({
        title: imported.title || path.basename(folderPath),
        documents: state.readingsSource.documents,
        sequence: state.organizerSequence,
        manualSlides: state.manualSlides,
        screenSettings: state.screenSettings
      });
      if (typeof liveTitle === "string") {
        state.presentation.title = liveTitle;
      }

      touch();
      io.emit("state:update", getStateSnapshot());
      scheduleSave(true);

      return res.json({ ok: true });
    } catch (error) {
      return sendApiError(res, error, "Failed to save reading.");
    }
  });

  // ── Session info ───────────────────────────────────────────────────────────
  // Local filesystem paths go only to clients that may control the Mass.
  app.get("/api/session-info", (req, res) => {
    if (!clientMayControl(req)) {
      return res.json({ lastReadingsFolderPath: null, sessionFile: null });
    }
    return res.json({
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

  app.get("/api/network-addresses", (_, res) => {
    const addresses = listIpv4Addresses();
    res.json({ addresses, selectedAddress: state.appSettings?.remoteAddress || "" });
  });

  function broadcast(syncCurrentMass = false) {
    touch();
    invalidateStateCache();
    io.emit("state:update", getCachedStateSnapshot());
    scheduleSave(syncCurrentMass);
  }

  function broadcastProjectorCount() {
    touch();
    invalidateStateCache();
    io.emit("state:update", getCachedStateSnapshot());
  }

  function releaseInterstitialHold(returnSlideIndexOverride = null, explicitReturn = false) {
    if (!state.interstitialHoldActive) return false;

    // Use a new slide only when the operator chooses that slide.
    // Next and previous leave the stored return slide unchanged.
    const hasExplicitReturnIndex =
      explicitReturn === true && Number.isFinite(Number(returnSlideIndexOverride));
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

  function toggleInterstitialHold(returnSlideIndexOverride = null, explicitReturn = false) {
    if (state.interstitialHoldActive) {
      return releaseInterstitialHold(returnSlideIndexOverride, explicitReturn);
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
      activatePostMassLoop = false,
      direction = 1
    } = options;
    _manualNavigationDirection = direction < 0 ? -1 : 1;
    const previousSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
    state.currentSlideIndex = getSafeSlideIndex(index);
    const slide = (state.presentation?.slides || [])[state.currentSlideIndex];
    const sameSlideshow = previousSlide?.type === "imageSlideshow" &&
      slide?.type === "imageSlideshow" &&
      previousSlide.organizerItemId === slide.organizerItemId;
    stopImageSlideshowTimer({ resetProgress: !sameSlideshow, clearError: !sameSlideshow });
    // A movie's fallback advance belongs to the slide that scheduled it.
    stopMovieAutoAdvanceTimer();
    clearMoviePlaybackError();
    _movieEndGuard.reset();
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
    if (slide?.type === "imageSlideshow" &&
      !state.preMassRunning && !state.gatheringRunning && !state.postMassRunning) {
      scheduleImageSlideshowSlide(io);
    }
    broadcast();
  }

  function stepSlide(step) {
    const nextIndex = state.currentSlideIndex + step;
    setSlide(nextIndex, { direction: step });
  }

  function parseSlideCommandIndex(index) {
    const numeric = Number(index);
    if (Number.isFinite(numeric) && !Number.isInteger(numeric)) return null;
    return numeric || 0;
  }

  // Initialize session restore and timers only after the HTTP server starts listening.

  function withControl(socket, eventName, handler) {
    return safeSocketHandler(socket, eventName, (...args) => {
      if (!sourceNetworkGuard.isAllowedAddress(getSocketSourceAddress(socket))) {
        socket.disconnect(true);
        return undefined;
      }
      if (!socketMayControl(socket)) {
        socket.emit("control:required", { error: getUnlockMessage() });
        return undefined;
      }
      return handler(...args);
    });
  }

  function withScreenReport(socket, eventName, handler) {
    return safeSocketHandler(socket, eventName, (...args) => {
      const projectorIsTrusted = socket.data.screenRole === "projector" && (
        isLoopbackAddress(socket.request?.socket?.remoteAddress)
        || socketHasControlSession(socket)
      );
      if (!socketMayControl(socket) && !projectorIsTrusted) {
        socket.emit("control:required", { error: getUnlockMessage() });
        return undefined;
      }
      return handler(...args);
    });
  }

  io.on("connection", (socket) => {
    socket.data.screenRole = socket.handshake.auth?.screenRole === "projector" ? "projector" : "client";
    if (socket.data.screenRole === "projector") {
      state.projectorCount += 1;
      broadcastProjectorCount();
    }
    socket.emit("state:update", getCachedStateSnapshot(true));

    socket.on("disconnect", () => {
      if (socket.data.screenRole !== "projector") return;
      state.projectorCount = Math.max(0, state.projectorCount - 1);
      broadcastProjectorCount();
    });

    socket.on("control:auth", safeSocketHandler(socket, "control:auth", (payload) => {
      socket.data.controlToken = String(payload?.token || "");
      if (socketMayControl(socket)) {
        socket.emit("control:ok");
        return;
      }
      socket.data.controlToken = "";
      socket.emit("control:required", { error: "Unlock required." });
    }));
    socket.on("control:lock", safeSocketHandler(socket, "control:lock", () => {
      const token = getValidControlSessionToken(socket);
      if (!token) {
        socket.emit("control:required", { error: getUnlockMessage() });
        return;
      }
      clearControlSession(token);
      socket.data.controlToken = "";
      socket.emit("control:required", { error: "This remote is locked." });
    }));

    socket.on("screen:settings", withControl(socket, "screen:settings", (settings) => {
      if (screenSettingsUrlError(settings)) {
        return;
      }
      state.screenSettings = normalizeScreenSettings(settings || {});
      repaginateReadingSlidesIfNeeded();
      broadcast(true);
    }));

    socket.on("slide:next", withControl(socket, "slide:next", () => stepSlide(1)));
    socket.on("slide:prev", withControl(socket, "slide:prev", () => stepSlide(-1)));
    socket.on("slide:goto", withControl(socket, "slide:goto", (index) => {
      const parsedIndex = parseSlideCommandIndex(index);
      if (parsedIndex === null) return;
      setSlide(parsedIndex);
    }));
    socket.on("slide:goto:remote", withControl(socket, "slide:goto:remote", (index) => {
      const parsedIndex = parseSlideCommandIndex(index);
      if (parsedIndex === null) return;
      setSlide(parsedIndex, {
        activateGatheringSequence: true,
        activatePostMassLoop: true
      });
    }));
    socket.on("slide:video-ended", withScreenReport(socket, "slide:video-ended", (payload) => {
      const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
      const slideId = String(payload?.slideId || "");
      if (!shouldMovieSlideControlAdvance(currentSlide)) return;
      if (!currentSlide?.id || slideId !== currentSlide.id) return;
      // Several screen windows can report the end of the same movie; the first
      // one advances and the rest of that slide's reports are ignored.
      if (_movieEndGuard.alreadyHandled(state.currentSlideIndex, slideId)) return;
      _movieEndGuard.markHandled(state.currentSlideIndex, slideId);
      stopMovieAutoAdvanceTimer();
      advanceFromCurrentSlide(io);
    }));
    socket.on("slide:video-play-failed", withScreenReport(socket, "slide:video-play-failed", (payload) => {
      const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
      const slideId = String(payload?.slideId || "");
      if (!shouldMovieSlideControlAdvance(currentSlide)) return;
      if (!currentSlide?.id || slideId !== currentSlide.id) return;
      stopMovieAutoAdvanceTimer();
      state.moviePlaybackError = {
        slideId,
        message: `Could not start ${currentSlide.title || "the movie"}; autoplay was blocked.`
      };
      touch();
      io.emit("state:update", getStateSnapshot());
    }));
    socket.on("slide:video-ready", withScreenReport(socket, "slide:video-ready", (payload) => {
      const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
      const slideId = String(payload?.slideId || "");
      if (!shouldMovieSlideControlAdvance(currentSlide)) return;
      if (!currentSlide?.id || slideId !== currentSlide.id) return;
      if (state.moviePlaybackError?.slideId === slideId) return;
      const durationMs = Number(payload?.durationMs);
      if (!Number.isFinite(durationMs) || durationMs <= 0) return;
      const startedAt = _moviePlaybackSlideId === currentSlide.id ? _moviePlaybackStartedAt : null;
      scheduleMovieAutoAdvance(io, durationMs, { startedAt });
    }));
    socket.on("image-slideshow:preload-error", withScreenReport(socket, "image-slideshow:preload-error", (payload) => {
      if (socket.data.screenRole !== "projector") return;
      const imageUrl = String(payload?.imageUrl || "");
      const slideId = String(payload?.slideId || "");
      const failedSlide = (state.presentation?.slides || []).find((slide) =>
        slide.type === "imageSlideshow" && slide.id === slideId && slide.imageUrl === imageUrl
      );
      if (!failedSlide || !imageUrl) return;
      _imageSlideshowFailedUrls.add(imageUrl);
      state.imageSlideshowError = `Could not preload ${failedSlide.slideshowImageName || "an image"}; it will be skipped.`;
      touch();
      io.emit("state:update", getStateSnapshot());
    }));
    socket.on("screen:interstitial-hold", withControl(socket, "screen:interstitial-hold", (payload) => {
      if (!toggleInterstitialHold(payload?.returnSlideIndex, payload?.explicitReturn === true)) {
        socket.emit("interstitial:hold:error", { error: "No interstitial slide is available." });
      }
    }));

    socket.on("screen:black", withControl(socket, "screen:black", (isBlack) => {
      state.isBlack = Boolean(isBlack);
      broadcast();
    }));

    socket.on("export:avif:start", safeSocketHandler(socket, "export:avif:start", async () => {
      if (!socketHasControlSession(socket)) {
        socket.emit("control:required", { error: "Unlock required." });
        return;
      }
      const limitState = heavySocketRateLimit(socket);
      if (!limitState.allowed) {
        socket.emit("export:avif:error", { error: `Too many requests. Retry after ${limitState.retryAfterSec}s.` });
        return;
      }

      try {
        saveCurrentMass();
        const exportState = structuredClone(state);
        const sharp = require("sharp");
        const zip = new (getAdmZip())();

        // Collect media URLs referenced by manual slides and image URLs from screen settings.
        const mediaRefs = [];
        for (const [id, slide] of Object.entries(exportState.manualSlides || {})) {
          if (slide.imageUrl) {
            mediaRefs.push({ url: slide.imageUrl, type: "slide", id });
          }
          if (slide.videoUrl) {
            mediaRefs.push({ url: slide.videoUrl, type: "slide", id });
          }
          for (const image of slide.images || []) {
            const url = typeof image === "string" ? image : image?.url;
            if (url) mediaRefs.push({ url, type: "slide", id });
          }
        }
        for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
          const url = exportState.screenSettings?.[key];
          if (url) mediaRefs.push({ url, type: "screenSetting", key });
        }

        // Resolve image URLs to filesystem paths and skip built-ins or missing files.
        const CONVERTIBLE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".tif"]);
        const assetsDir = path.join(CURRENT_MASS_DIR, "assets");
        const resolved = [];
        for (const ref of mediaRefs) {
          const url = ref.url;
          let filePath = null;
          let originalName = null;

          const assetMatch = url.match(/\/api\/mass-asset\/([^/]+)$/);
          if (assetMatch) {
            originalName = decodeAssetName(assetMatch[1]);
            if (isSafeAssetName(originalName)) filePath = path.join(assetsDir, originalName);
          }
          if (url.startsWith("/static/assets/")) continue;
          if (!filePath || !originalName || !fs.existsSync(filePath)) continue;
          resolved.push({ url, filePath, originalName });
        }

        const total = resolved.length;
        const urlRemap = new Map();
        const assignAvifName = createAvifNameAllocator(assetsDir);
        const avifBySource = new Map();
        const convertImage = module.exports.convertImageToAvif || convertImageToAvif;

        for (let i = 0; i < resolved.length; i++) {
          const { url, filePath, originalName } = resolved[i];
          const ext = path.extname(originalName).toLowerCase();

          socket.emit("export:avif:progress", {
            current: i + 1,
            total,
            filename: originalName
          });

          if (CONVERTIBLE_EXT.has(ext)) {
            const isNewSource = !assignAvifName.has(filePath);
            const avifName = assignAvifName(filePath, originalName, ext);
            if (isNewSource) {
              avifBySource.set(filePath, await convertImage(sharp, filePath));
            }
            const avifBuffer = avifBySource.get(filePath);
            if (avifBuffer) {
              if (isNewSource) zip.addFile(`assets/${avifName}`, avifBuffer);
              urlRemap.set(url, `assets/${avifName}`);
            } else {
              zip.addFile(`assets/${originalName}`, fs.readFileSync(filePath));
            }
          } else {
            zip.addFile(`assets/${originalName}`, fs.readFileSync(filePath));
          }
        }

        const massDocument = buildMassDocumentFromState(exportState);
        for (const item of massDocument.items || []) {
          if (item.asset?.ref) {
            const url = assetUrlFromName(path.basename(item.asset.ref));
            if (urlRemap.has(url)) {
              item.asset.ref = urlRemap.get(url);
            }
          }
          for (const asset of item.assets || []) {
            if (!asset?.ref) continue;
            const url = assetUrlFromName(path.basename(asset.ref));
            if (urlRemap.has(url)) {
              asset.ref = urlRemap.get(url);
            }
          }
        }
        for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
          const ref = massDocument.presentationDefaults?.[key];
          if (ref && !String(ref).startsWith("assets/")) {
            continue;
          }
          const url = ref ? assetUrlFromName(path.basename(ref)) : null;
          if (url && urlRemap.has(url)) {
            massDocument.presentationDefaults[key] = urlRemap.get(url);
          }
        }
        zip.addFile("mass.json", Buffer.from(JSON.stringify(massDocument, null, 2)));

        const zipBuffer = zip.toBuffer();
        const filename = buildExportFilename(exportState.presentation?.title, exportState.massStartTime, "-avif.zip");

        const token = crypto.randomBytes(16).toString("hex");
        const expiryTimer = setTimeout(() => avifDownloadTokens.delete(token), 5 * 60 * 1000);
        expiryTimer.unref?.();
        storeAvifDownloadToken(token, {
          zipBuffer,
          filename,
          controlToken: getValidControlSessionToken(socket) || null,
          expiryTimer
        });

        socket.emit("export:avif:done", { token });
      } catch (error) {
        socket.emit("export:avif:error", { error: error.message || "Failed to export AVIF ZIP." });
      } finally {
        limitState.release();
      }
    }));
  });

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
    restoreSession(io);
    if (process.env.SACRA_LUX_RESET_PIN === "1") {
      resetStartPin();
      logger.info("[security] Start PIN reset at startup.");
    }
    const restoredSourceNetworks = state.appSettings?.sourceNetworks || "";
    const restoredSource = sourceNetworkGuard.setAllowedEntries(restoredSourceNetworks);
    if (restoredSource.invalid.length) {
      state.appSettings.sourceNetworks = "";
      sourceNetworkGuard.setAllowedEntries("");
      logger.warn("[security] Ignoring invalid saved source-network allowlist.");
    }
    logger.info(`[security] Source-network restriction ${sourceNetworkGuard.entries.length ? "active" : "inactive"}.`);
    scheduleStartTimer(io);
    lastRuntimeClockAt = Date.now();
    runtimeTimerMonitor = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastRuntimeClockAt;
      lastRuntimeClockAt = now;
      if (elapsed > 5000) {
        rescheduleRuntimeTimers(io);
      }
    }, 1000);

    const currentSlide = (state.presentation?.slides || [])[state.currentSlideIndex];
    if (currentSlide?.type === "countdown") {
      startCountdownForSlide(io, state.countdownEndsAt);
    } else if (currentSlide?.type === "imageSlideshow") {
      scheduleImageSlideshowSlide(io);
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
    if (runtimeTimerMonitor) {
      clearInterval(runtimeTimerMonitor);
      runtimeTimerMonitor = null;
    }
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
    rescheduleStartTimer: () => rescheduleRuntimeTimers(io),
    get port() {
      return listeningPort;
    },
    close: closeServer
  };
}

module.exports = {
  startServer,
  saveCurrentMass,
  flushPendingSave,
  resetStartPin,
  convertImageToAvif,
  safeSocketHandler,
  validateMassZipArchive,
  MASS_ZIP_LIMITS: Object.freeze({
    maxCompressedBytes: MAX_MASS_ZIP_COMPRESSED_BYTES,
    maxEntries: MAX_MASS_ZIP_ENTRIES,
    maxUncompressedBytes: MAX_MASS_ZIP_UNCOMPRESSED_BYTES,
    maxEntryBytes: MAX_MASS_ZIP_ENTRY_BYTES
  })
};
