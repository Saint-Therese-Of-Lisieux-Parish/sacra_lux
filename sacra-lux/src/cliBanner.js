// Block letters for SACRA LUX. The font is FIGlet small.
const WORDMARK_LINES = [
  " ___   _   ___ ___    _     _   _   ___  __",
  "/ __| /_\\ / __| _ \\  /_\\   | | | | | \\ \\/ /",
  "\\__ \\/ _ \\ (__|   / / _ \\  | |_| |_| |>  <",
  "|___/_/ \\_\\___|_|_\\/_/ \\_\\ |____\\___//_/\\_\\"
];

const GOLD = "\u001b[33m";
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";

let bannerWasWritten = false;

function paint(line, code, useColor) {
  if (!useColor) {
    return line;
  }
  return `${code}${line}${RESET}`;
}

function buildStartupBanner({ version, env }) {
  const useColor = env.NO_COLOR === undefined;
  const lines = WORDMARK_LINES.map((line) => paint(line, GOLD, useColor));
  lines.push(paint(`version ${version}`, DIM, useColor));
  return lines.join("\n");
}

function shouldShowStartupBanner({ stdout, quiet }) {
  if (quiet) {
    return false;
  }
  return Boolean(stdout && stdout.isTTY);
}

function writeStartupBanner({ stdout, env, quiet, version, log }) {
  if (bannerWasWritten) {
    return false;
  }
  if (!shouldShowStartupBanner({ stdout, quiet })) {
    return false;
  }

  bannerWasWritten = true;
  log(buildStartupBanner({ version, env }));
  return true;
}

module.exports = {
  buildStartupBanner,
  shouldShowStartupBanner,
  writeStartupBanner
};
