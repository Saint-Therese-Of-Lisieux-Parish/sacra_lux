// Block letters for SACRA LUX. The font is FIGlet small.
const WORDMARK_LINES = [
  " ___   _   ___ ___    _     _   _   ___  __",
  "/ __| /_\\ / __| _ \\  /_\\   | | | | | \\ \\/ /",
  "\\__ \\/ _ \\ (__|   / / _ \\  | |_| |_| |>  <",
  "|___/_/ \\_\\___|_|_\\/_/ \\_\\ |____\\___//_/\\_\\"
];

// Three gold tones on each wordmark line. The middle tone is the brightest.
const SHEEN = [
  [136, 178, 136],
  [172, 214, 172],
  [178, 220, 178],
  [214, 220, 172]
];
const VERSION_COLOR = "\u001b[38;5;74m";
const RESET = "\u001b[0m";

let bannerWasWritten = false;

function splitThirds(line) {
  const first = Math.ceil(line.length / 3);
  const second = Math.ceil((line.length - first) / 2);
  return [
    line.slice(0, first),
    line.slice(first, first + second),
    line.slice(first + second)
  ];
}

function paintSheen(line, colors) {
  const parts = splitThirds(line);
  let painted = "";
  for (let index = 0; index < parts.length; index += 1) {
    painted += `\u001b[38;5;${colors[index]}m${parts[index]}`;
  }
  return painted + RESET;
}

function buildStartupBanner({ version, env }) {
  const useColor = env.NO_COLOR === undefined;
  const lines = WORDMARK_LINES.map((line, index) => {
    if (!useColor) {
      return line;
    }
    return paintSheen(line, SHEEN[index]);
  });
  const versionLine = `version ${version}`;
  lines.push(useColor ? `${VERSION_COLOR}${versionLine}${RESET}` : versionLine);
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
