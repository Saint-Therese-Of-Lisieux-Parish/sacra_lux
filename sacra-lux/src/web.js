const { startServer, flushPendingSave } = require("./server");
const logger = require("./logger");
const { writeStartupBanner } = require("./cliBanner");
const pkg = require("../package.json");

const PORT = Number(process.env.PORT || 17841);

writeStartupBanner({
  stdout: process.stdout,
  env: process.env,
  quiet: logger.isQuietLogs(),
  version: pkg.version,
  log: (message) => logger.info(message)
});

startServer(PORT);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    flushPendingSave();
    process.exit(0);
  });
}
