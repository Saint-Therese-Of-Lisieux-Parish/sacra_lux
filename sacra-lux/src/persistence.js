const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("./logger");
const { DEFAULT_THEME } = require("./themes");

const SESSION_FILE_NAME = "session.json";
const SESSION_DIR = path.join(os.homedir(), ".sacra-lux");
const SESSION_FILE_PATH = path.join(SESSION_DIR, SESSION_FILE_NAME);

const CURRENT_VERSION = 2;

function ensureDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Migrate a v1 session object to v2 format.
 * Changes:
 *   - manualCues → manualSlides
 *   - backgroundMode → backgroundType ("word" → "color", "graphic" → "image")
 *   - type: "reading-group" → "reading", "graphic" → "image"
 *   - phase: "warmup" → "gathering"
 *   - wordBackgroundUrl → colorBackgroundUrl
 *   - graphicBackgroundUrl → imageBackgroundUrl
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
    if (ds.wordBackgroundUrl && !ds.colorBackgroundUrl) {
      ds.colorBackgroundUrl = ds.wordBackgroundUrl;
      delete ds.wordBackgroundUrl;
    }
    if (ds.graphicBackgroundUrl && !ds.imageBackgroundUrl) {
      ds.imageBackgroundUrl = ds.graphicBackgroundUrl;
      delete ds.graphicBackgroundUrl;
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
      // Migrate background mode values.
      if (migItem.backgroundMode !== undefined) {
        if (migItem.backgroundMode === "word") migItem.backgroundType = "color";
        else if (migItem.backgroundMode === "graphic") migItem.backgroundType = "image";
        else migItem.backgroundType = migItem.backgroundMode;
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
    fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(sessionData, null, 2), "utf8");
  } catch (err) {
    logger.error(`[persistence] Failed to save session: ${err.message}`);
  }
}

/**
 * Load a previously saved session from disk.
 * Return null when no session file exists or the file is malformed.
 * Migrate older session formats automatically.
 */
function loadSession() {
  try {
    if (!fs.existsSync(SESSION_FILE_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(SESSION_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    // Apply migrations.
    let session = parsed;
    if (!session.version || session.version < 2) {
      session = migrateV1toV2(session);
      logger.info("[persistence] Migrated session from v1 to v2");
    }

    return session;
  } catch {
    return null;
  }
}

/** Return the session file path used for logging and UI display. */
function getSessionFilePath() {
  return SESSION_FILE_PATH;
}

module.exports = { saveSession, loadSession, getSessionFilePath };
