"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function tempPathFor(filePath) {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  const token = crypto.randomBytes(6).toString("hex");
  return path.join(dir, `.${name}.tmp-${process.pid}-${token}`);
}

/**
 * Write a file through a same-directory temporary file.
 *
 * The data is written, flushed, and closed before the destination is replaced.
 * `fs.renameSync` is atomic on one file system, so an interruption leaves
 * either the old complete file or the new complete file, never a partial one.
 * The temporary file is removed after success and after failure.
 *
 * With `keepBackup`, the previous destination is copied to `<filePath>.bak`
 * before the replacement. The copy is not atomic, but the destination stays
 * valid until the atomic rename.
 */
function writeFileAtomic(filePath, data, { keepBackup = false } = {}) {
  const tempPath = tempPathFor(filePath);
  let fd = null;

  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    if (keepBackup && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, `${filePath}.bak`);
    }

    fs.renameSync(tempPath, filePath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // The original error is more useful than a close error here.
      }
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Leave no temporary file behind, but do not hide the write error.
    }
  }
}

module.exports = { writeFileAtomic };
