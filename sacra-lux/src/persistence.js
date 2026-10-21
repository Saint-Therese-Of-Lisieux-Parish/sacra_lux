const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("./logger");
const { writeFileAtomic } = require("./atomicWrite");
const { DEFAULT_THEME } = require("./themes");

const SESSION_FILE_NAME = "session.json";

const CURRENT_VERSION = 2;

// Resolve the directory on each call. `os.homedir()` can keep a cached value
// in some runtimes, and tests change HOME to isolate writes from the real
// runtime data.
function getSessionDir() {
  return path.join(process.env.HOME || os.homedir(), ".sacra-lux");
}

function getSessionFilePath() {
  return path.join(getSessionDir(), SESSION_FILE_NAME);
}

function getSessionBackupPath() {
  return `${getSessionFilePath()}.bak`;
}

function ensureDir() {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Migrate a v1 session object to v2 format.
 * Changes:
 *   - manualCues → manualSlides
 *   - backgroundType/backgroundMode → backgroundTheme ("word"/"color" → "dark", "graphic"/"image" → "light")
 *   - type: "reading-group" → "reading", "graphic" → "image"
 *   - phase: "warmup" → "gathering"
 *   - wordBackgroundUrl/colorBackgroundUrl → darkBackgroundUrl
 *   - graphicBackgroundUrl/imageBackgroundUrl → lightBackgroundUrl
 *   - currentCueIndex → currentSlideIndex
 */
function migrateV1toV2(session) {
  const migrated = { ...session, version: 2 };

  // Rename manualCues to manualSlides.
  if (session.manualCues && !session.manualSlides) {
    migrated.manualSlides = session.manualCues;
    delete migrated.manualCues;
  }

  // Migrate legacy screen-setting field names.
  if (migrated.displaySettings && !migrated.screenSettings) {
    migrated.screenSettings = migrated.displaySettings;
    delete migrated.displaySettings;
  }
  if (migrated.screenSettings) {
    const ds = migrated.screenSettings;
    if (ds.wordBackgroundUrl && !ds.darkBackgroundUrl) {
      ds.darkBackgroundUrl = ds.wordBackgroundUrl;
      delete ds.wordBackgroundUrl;
    }
    if (ds.colorBackgroundUrl && !ds.darkBackgroundUrl) {
      ds.darkBackgroundUrl = ds.colorBackgroundUrl;
      delete ds.colorBackgroundUrl;
    }
    if (ds.graphicBackgroundUrl && !ds.lightBackgroundUrl) {
      ds.lightBackgroundUrl = ds.graphicBackgroundUrl;
      delete ds.graphicBackgroundUrl;
    }
    if (ds.imageBackgroundUrl && !ds.lightBackgroundUrl) {
      ds.lightBackgroundUrl = ds.imageBackgroundUrl;
      delete ds.imageBackgroundUrl;
    }
  }

  if (migrated.targetDisplayId != null && migrated.targetScreenId == null) {
    migrated.targetScreenId = migrated.targetDisplayId;
    delete migrated.targetDisplayId;
  }

  if (migrated.displayFullscreen != null && migrated.screenFullscreen == null) {
    migrated.screenFullscreen = migrated.displayFullscreen;
    delete migrated.displayFullscreen;
  }

  // Migrate organizer sequence items.
  if (Array.isArray(migrated.organizerSequence)) {
    migrated.organizerSequence = migrated.organizerSequence.map((item) => {
      const migItem = { ...item };
      // Migrate type values.
      if (migItem.type === "reading-group") migItem.type = "reading";
      if (migItem.type === "graphic") migItem.type = "image";
      // Migrate phase values.
      if (migItem.phase === "warmup") migItem.phase = "gathering";
      // Migrate legacy background naming onto the new backgroundTheme field.
      const legacyBackground = migItem.backgroundTheme ?? migItem.backgroundType ?? migItem.backgroundMode;
      if (legacyBackground !== undefined) {
        if (legacyBackground === "word" || legacyBackground === "color") migItem.backgroundTheme = "dark";
        else if (legacyBackground === "graphic" || legacyBackground === "image") migItem.backgroundTheme = "light";
        else migItem.backgroundTheme = legacyBackground;
        delete migItem.backgroundType;
        delete migItem.backgroundMode;
      }
      return migItem;
    });
  }

  return migrated;
}

/**
 * Save the durable parts of state to disk.
 * Omit the parsed documents array because it can be reloaded from disk.
 */
function saveSession(state) {
  try {
    ensureDir();
    const targetScreenIds = Array.isArray(state.targetScreenIds)
      ? [...new Set(state.targetScreenIds.map((id) => Number(id)).filter(Number.isFinite))]
      : [];
    const sessionData = {
      version: CURRENT_VERSION,
      savedAt: new Date().toISOString(),
      screenSettings: state.screenSettings,
      organizerSequence: state.organizerSequence,
      manualSlides: state.manualSlides,
      lastReadingsFolderPath: state.readingsSource?.folderPath || null,
      presentationTitle: state.presentation?.title || null,
      massStartTime: state.massStartTime || null,
      startPinHash: state.startPinHash || null,
      targetScreenId: targetScreenIds[0] ?? state.targetScreenId ?? null,
      targetScreenIds,
      screenFullscreen: Boolean(state.screenFullscreen),
      activeMassArchiveId: state.activeMassArchiveId || null,
      appSettings: state.appSettings || { theme: DEFAULT_THEME }
    };
    writeFileAtomic(getSessionFilePath(), JSON.stringify(sessionData, null, 2), {
      keepBackup: true
    });
  } catch (err) {
    logger.error(`[persistence] Failed to save session: ${err.message}`);
  }
}
/**
 * Parse session text and migrate it to the current format.
 * Throw when the text is not JSON or is not an object.
 */
function parseSession(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("session data is not an object");
  }

  if (!parsed.version || parsed.version < 2) {
    logger.info("[persistence] Migrated session from v1 to v2");
    return migrateV1toV2(parsed);
  }

  return parsed;
}

/**
 * Load a previously saved session from disk.
 * Return null when no session file exists.
 * If the primary file is damaged, log the damage and recover from the backup.
 */
function loadSession() {
  if (!fs.existsSync(getSessionFilePath())) {
    return null;
  }

  try {
    return parseSession(fs.readFileSync(getSessionFilePath(), "utf8"));
  } catch (err) {
    logger.warn(`[persistence] Session file is damaged (${err.message}); trying the backup.`);
  }

  if (fs.existsSync(getSessionBackupPath())) {
    try {
      const session = parseSession(fs.readFileSync(getSessionBackupPath(), "utf8"));
      logger.warn("[persistence] Recovered the session from the backup file.");
      return session;
    } catch (err) {
      logger.warn(`[persistence] Session backup is damaged too (${err.message}).`);
    }
  }

  return null;
}

module.exports = { saveSession, loadSession, getSessionFilePath };
