let quietLogs = false;

function setQuietLogs(enabled) {
  quietLogs = Boolean(enabled);
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
}

function error(message) {
  // Keep server and persistence failures visible even when routine logs are quiet.
  // eslint-disable-next-line no-console
  console.error(message);
}

module.exports = {
  error,
  info,
  setQuietLogs,
  warn
};
