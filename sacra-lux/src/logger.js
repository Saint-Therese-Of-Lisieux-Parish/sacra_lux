const fs = require("fs");
const path = require("path");

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_FILE_NAME = "sacra-lux.log";

let quietLogs = false;
let packaged = false;
let dataDirectory = "";

function configure({ isPackaged = false, logDirectory = "" } = {}) {
  packaged = Boolean(isPackaged);
  dataDirectory = packaged && logDirectory ? path.resolve(logDirectory) : "";
}

function redact(message) {
  return String(message)
    .replace(/(\b(?:pin|startPin|controlToken|token|hash|salt)\b\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
}

function writeFileLog(level, message) {
  if (!packaged || !dataDirectory) {
    return;
  }

  const logPath = path.join(dataDirectory, LOG_FILE_NAME);
  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_LOG_BYTES) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
    const line = `${new Date().toISOString()} ${level} ${redact(message)}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch (writeError) {
    // Keep console logging available when the data folder cannot be written.
    // eslint-disable-next-line no-console
    console.error(`[logger] Could not write ${LOG_FILE_NAME}: ${writeError.message}`);
  }
}

function setQuietLogs(enabled) {
  quietLogs = Boolean(enabled);
}

function isQuietLogs() {
  return quietLogs;
}

function info(message) {
  if (quietLogs) {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(message);
}

function warn(message) {
  // eslint-disable-next-line no-console
  console.warn(message);
  writeFileLog("WARN", message);
}

function error(message) {
  // Keep server and persistence failures visible even when routine logs are quiet.
  // eslint-disable-next-line no-console
  console.error(message);
  writeFileLog("ERROR", message);
}

module.exports = {
  configure,
  error,
  info,
  isQuietLogs,
  setQuietLogs,
  warn
};
