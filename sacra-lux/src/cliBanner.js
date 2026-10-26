// Block letters for SACRA LUX. The font is FIGlet small.
const WORDMARK_LINES = [
  " ___   _   ___ ___    _     _   _   ___  __",
  "/ __| /_\\ / __| _ \\  /_\\   | | | | | \\ \\/ /",
  "\\__ \\/ _ \\ (__|   / / _ \\  | |_| |_| |>  <",
  "|___/_/ \\_\\___|_|_\\/_/ \\_\\ |____\\___//_/\\_\\"
];

// The first LUX_START columns of each wordmark line spell "SACRA". The rest spell "LUX".
const LUX_START = 27;

// Blue tones for "SACRA", from dark to light. The gradient runs left to right.
const SACRA_BLUES = [27, 33, 39, 45, 81];

// Three gold tones for "LUX" on each wordmark line. The middle tone is the brightest.
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

function paintGradient(text, colors) {
  const step = text.length / colors.length;
  let painted = "";
  let previous = -1;
  for (let index = 0; index < text.length; index += 1) {
    const color = colors[Math.floor(index / step)];
    if (color !== previous) {
      painted += `\u001b[38;5;${color}m`;
      previous = color;
    }
    painted += text[index];
  }
  return painted;
}

function paintWordmark(line, colors) {
  return (
    paintGradient(line.slice(0, LUX_START), SACRA_BLUES) +
    paintSheen(line.slice(LUX_START), colors)
  );
}

function buildStartupBanner({ version, env }) {
  const useColor = env.NO_COLOR === undefined;
  const lines = WORDMARK_LINES.map((line, index) => {
    if (!useColor) {
      return line;
    }
    return paintWordmark(line, SHEEN[index]);
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
