const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME_DIR = process.env.HOME || os.homedir();
const SACRA_LUX_DIR = path.join(HOME_DIR, ".sacra-lux");
const CURRENT_MASS_DIR = path.join(SACRA_LUX_DIR, "current_mass");
const MASS_HISTORY_DIR = path.join(SACRA_LUX_DIR, "mass_history");

function sanitizeForFilename(str) {
  return String(str || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeArchiveId(value) {
  const cleaned = sanitizeForFilename(value);
  if (!cleaned) {
    throw new Error("Invalid archive id.");
  }
  return cleaned;
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
  const archiveDir = path.join(MASS_HISTORY_DIR, id);
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
  const existing = new Set(listArchiveIds());
  if (excludeId) {
    existing.delete(normalizeArchiveId(excludeId));
  }
  if (!existing.has(base)) {
    return base;
  }
  let index = 2;
  while (existing.has(`${base}-${index}`)) {
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
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function writeMetadata(archiveId, metadata) {
  const paths = getArchivePaths(archiveId);
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(paths.metadataPath, JSON.stringify(metadata, null, 2), "utf8");
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

  const desiredId = currentArchiveId
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
    fs.rmSync(paths.packageDir, { recursive: true, force: true });
  }
  if (fs.existsSync(CURRENT_MASS_DIR)) {
    fs.cpSync(CURRENT_MASS_DIR, paths.packageDir, { recursive: true });
  } else {
    fs.mkdirSync(paths.packageDir, { recursive: true });
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
  sanitizeForFilename,
  getArchivePaths,
  readMetadata,
  writeMetadata,
  ensureActiveArchive,
  syncCurrentMassToArchive,
  listMassArchives,
  deleteMassArchive
};
