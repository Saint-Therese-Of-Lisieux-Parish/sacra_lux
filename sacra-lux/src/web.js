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

const { server } = startServer(PORT);

server.once("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    process.stderr.write(`Port ${PORT} is already in use. Stop the other process or set PORT to a free port.\n`);
  } else {
    process.stderr.write(`Cannot start the web server: ${error?.message || error}\n`);
  }
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    flushPendingSave();
    process.exit(0);
  });
}
