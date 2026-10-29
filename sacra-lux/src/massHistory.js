const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeFileAtomic } = require("./atomicWrite");
const logger = require("./logger");

const HOME_DIR = process.env.HOME || os.homedir();
const SACRA_LUX_DIR = path.join(HOME_DIR, ".sacra-lux");
const CURRENT_MASS_DIR = path.join(SACRA_LUX_DIR, "current_mass");
const MASS_HISTORY_DIR = path.join(SACRA_LUX_DIR, "mass_history");

class InvalidArchiveIdError extends Error {
  constructor(message = "Invalid archive id.") {
    super(message);
    this.name = "InvalidArchiveIdError";
  }
}

// Leaves room under the 255-byte file name limit for the "-N" collision suffix.
const MAX_ARCHIVE_ID_BYTES = 200;

function truncateToBytes(str, maxBytes) {
  let out = str;
  while (Buffer.byteLength(out, "utf8") > maxBytes) {
    out = Array.from(out).slice(0, -1).join("");
  }
  return out;
}

function sanitizeForFilename(str) {
  const cleaned = String(str || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return truncateToBytes(cleaned, MAX_ARCHIVE_ID_BYTES).replace(/-$/, "");
}

function normalizeArchiveId(value) {
  const trimmed = String(value ?? "").trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0")
  ) {
    throw new InvalidArchiveIdError();
  }
  const cleaned = sanitizeForFilename(trimmed);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new InvalidArchiveIdError();
  }
  return cleaned;
}

function assertArchiveDirInsideHistory(archiveDir) {
  const historyRoot = path.resolve(MASS_HISTORY_DIR);
  const resolved = path.resolve(archiveDir);
  const relative = path.relative(historyRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  ) {
    throw new InvalidArchiveIdError();
  }
  return resolved;
}

function ensureHistoryDir() {
  fs.mkdirSync(MASS_HISTORY_DIR, { recursive: true });
}

function listArchiveIds() {
  ensureHistoryDir();
  return fs.readdirSync(MASS_HISTORY_DIR).filter((name) => {
    const fullPath = path.join(MASS_HISTORY_DIR, name);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
  });
}

function getArchivePaths(archiveId) {
  const id = normalizeArchiveId(archiveId);
  const archiveDir = assertArchiveDirInsideHistory(path.join(MASS_HISTORY_DIR, id));
  return {
    archiveId: id,
    archiveDir,
    metadataPath: path.join(archiveDir, "metadata.json"),
    packageDir: path.join(archiveDir, "package"),
    compressedZipPath: path.join(archiveDir, "archive-avif.zip")
  };
}

function allocateArchiveId(title, excludeId = null) {
  ensureHistoryDir();
  const base = sanitizeForFilename(title) || "Mass";
  const excluded = excludeId ? normalizeArchiveId(excludeId).toLowerCase() : null;
  const existing = new Set(listArchiveIds()
    .filter((archiveId) => archiveId.toLowerCase() !== excluded)
    .map((archiveId) => archiveId.toLowerCase()));
  if (!existing.has(base.toLowerCase())) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base}-${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base}-${index}`;
}

function readMetadata(archiveId) {
  const paths = getArchivePaths(archiveId);
  if (!fs.existsSync(paths.metadataPath)) {
    return null;
  }
  const raw = fs.readFileSync(paths.metadataPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(`[massHistory] Ignoring damaged metadata.json for archive ${archiveId}: ${err.message}`);
    return null;
  }
  return parsed && typeof parsed === "object" ? parsed : null;
}

function writeMetadata(archiveId, metadata) {
  const paths = getArchivePaths(archiveId);
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  writeFileAtomic(paths.metadataPath, JSON.stringify(metadata, null, 2));
  return metadata;
}

function getDirectorySize(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

function getArchiveSize(paths) {
  if (fs.existsSync(paths.compressedZipPath)) {
    return fs.statSync(paths.compressedZipPath).size;
  }
  if (fs.existsSync(paths.packageDir)) {
    return getDirectorySize(paths.packageDir);
  }
  return 0;
}

function copyFileAtomically(sourcePath, targetPath) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.copyFileSync(sourcePath, temporaryPath);
    fs.renameSync(temporaryPath, targetPath);
    const sourceStats = fs.statSync(sourcePath);
    fs.utimesSync(targetPath, sourceStats.atime, sourceStats.mtime);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function syncDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const sourceEntries = fs.readdirSync(sourceDir, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isDirectory()) {
        fs.rmSync(targetPath, { force: true });
      }
      syncDirectory(sourcePath, targetPath);
      continue;
    }

    const targetStats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
    const sourceStats = fs.statSync(sourcePath);
    if (targetStats?.isFile() && targetStats.size === sourceStats.size && targetStats.mtimeMs === sourceStats.mtimeMs) {
      continue;
    }
    if (targetStats && !targetStats.isFile()) fs.rmSync(targetPath, { recursive: true, force: true });
    copyFileAtomically(sourcePath, targetPath);
  }

  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!sourceNames.has(entry.name)) {
      fs.rmSync(path.join(targetDir, entry.name), { recursive: true, force: true });
    }
  }
}

function ensureActiveArchive({ currentArchiveId, title, startTime }) {
  ensureHistoryDir();

  const now = new Date().toISOString();
  const preferredId = allocateArchiveId(title, currentArchiveId || null);
  let archiveId = currentArchiveId ? normalizeArchiveId(currentArchiveId) : preferredId;
  let paths = getArchivePaths(archiveId);
  let metadata = fs.existsSync(paths.metadataPath) ? readMetadata(archiveId) : null;

  if (!metadata && currentArchiveId) {
    archiveId = preferredId;
    paths = getArchivePaths(archiveId);
  }

  const desiredId = currentArchiveId && preferredId.toLowerCase() !== archiveId.toLowerCase()
    ? allocateArchiveId(title, archiveId)
    : archiveId;

  if (archiveId !== desiredId && fs.existsSync(paths.archiveDir)) {
    const nextPaths = getArchivePaths(desiredId);
    fs.renameSync(paths.archiveDir, nextPaths.archiveDir);
    archiveId = desiredId;
    paths = nextPaths;
    metadata = metadata ? { ...metadata, id: archiveId } : null;
  }

  const existing = metadata || {};
  const nextMetadata = {
    id: archiveId,
    title: String(title || "").trim() || "Mass",
    startTime: startTime || null,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    storage: fs.existsSync(paths.compressedZipPath) ? "compressed" : "folder"
  };
  writeMetadata(archiveId, nextMetadata);

  return { archiveId, paths, metadata: nextMetadata };
}

function syncCurrentMassToArchive({ currentArchiveId, title, startTime }) {
  const ensured = ensureActiveArchive({ currentArchiveId, title, startTime });
  const { archiveId, paths, metadata } = ensured;
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  if (fs.existsSync(paths.packageDir)) {
    if (!fs.statSync(paths.packageDir).isDirectory()) {
      fs.rmSync(paths.packageDir, { force: true });
      fs.mkdirSync(paths.packageDir, { recursive: true });
    }
  } else {
    fs.mkdirSync(paths.packageDir, { recursive: true });
  }
  if (fs.existsSync(CURRENT_MASS_DIR)) {
    syncDirectory(CURRENT_MASS_DIR, paths.packageDir);
  } else {
    for (const entry of fs.readdirSync(paths.packageDir)) {
      fs.rmSync(path.join(paths.packageDir, entry), { recursive: true, force: true });
    }
  }
  if (fs.existsSync(paths.compressedZipPath)) {
    fs.rmSync(paths.compressedZipPath, { force: true });
  }

  const nextMetadata = {
    ...metadata,
    storage: "folder",
    updatedAt: new Date().toISOString()
  };
  writeMetadata(archiveId, nextMetadata);
  return {
    ...nextMetadata,
    sizeBytes: getArchiveSize(paths)
  };
}

function listMassArchives(activeArchiveId = null) {
  ensureHistoryDir();
  return listArchiveIds()
    .map((archiveId) => {
      const paths = getArchivePaths(archiveId);
      const metadata = readMetadata(archiveId) || {
        id: archiveId,
        title: archiveId,
        startTime: null,
        createdAt: null,
        updatedAt: null,
        storage: fs.existsSync(paths.compressedZipPath) ? "compressed" : "folder"
      };
      return {
        ...metadata,
        hasPackage: fs.existsSync(paths.packageDir),
        hasCompressedZip: fs.existsSync(paths.compressedZipPath),
        sizeBytes: getArchiveSize(paths),
        isActive: archiveId === activeArchiveId
      };
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) {
        return a.isActive ? -1 : 1;
      }
      const aTime = Date.parse(a.updatedAt || a.createdAt || 0) || 0;
      const bTime = Date.parse(b.updatedAt || b.createdAt || 0) || 0;
      return bTime - aTime;
    });
}

function deleteMassArchive(archiveId) {
  const paths = getArchivePaths(archiveId);
  if (!fs.existsSync(paths.archiveDir)) {
    return false;
  }
  fs.rmSync(paths.archiveDir, { recursive: true, force: true });
  return true;
}

module.exports = {
  CURRENT_MASS_DIR,
  MASS_HISTORY_DIR,
  InvalidArchiveIdError,
  sanitizeForFilename,
  getArchivePaths,
  readMetadata,
  writeMetadata,
  ensureActiveArchive,
  syncCurrentMassToArchive,
  listMassArchives,
  deleteMassArchive
};
