const pkg = require("../../package.json");

const WORDMARK_LINES = [
  " ___   _   ___ ___    _     _   _   ___  __",
  "/ __| /_\\ / __| _ \\  /_\\   | | | | | \\ \\/ /",
  "\\__ \\/ _ \\ (__|   / / _ \\  | |_| |_| |>  <",
  "|___/_/ \\_\\___|_|_\\/_/ \\_\\ |____\\___//_/\\_\\"
];

const GOLD = [
  [136, 178, 136],
  [172, 214, 172],
  [178, 220, 178],
  [214, 220, 172]
];
const GOLD_FIRST = GOLD.map((tones) => `\u001b[38;5;${tones[0]}m`);
const BLUES = [27, 33, 39, 45, 81];

function stripCodes(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function loadBanner() {
  return require("../../src/cliBanner");
}

describe("startup banner", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("shows the block-letter name and the package version", () => {
    const { buildStartupBanner } = loadBanner();
    const text = buildStartupBanner({
      version: pkg.version,
      env: { NO_COLOR: "1" }
    });

    for (const line of WORDMARK_LINES) {
      expect(text).toContain(line);
    }
    expect(text).toContain(pkg.version);
  });

  test("keeps each line within 80 visible characters", () => {
    const { buildStartupBanner } = loadBanner();
    const plain = buildStartupBanner({
      version: pkg.version,
      env: { NO_COLOR: "1" }
    });
    const colored = buildStartupBanner({
      version: pkg.version,
      env: {}
    });

    for (const text of [plain, colored]) {
      for (const line of text.split("\n")) {
        expect(stripCodes(line).length).toBeLessThanOrEqual(80);
      }
    }
  });

  test("paints Sacra with a blue gradient and Lux with gold on each line", () => {
    const { buildStartupBanner } = loadBanner();
    const lines = buildStartupBanner({
      version: pkg.version,
      env: {}
    }).split("\n");

    lines.slice(0, 4).forEach((line, index) => {
      const luxStart = line.indexOf(GOLD_FIRST[index]);
      expect(luxStart).toBeGreaterThan(0);

      const sacraCodes = line.slice(0, luxStart).match(/\u001b\[38;5;\d+m/g);
      expect(new Set(sacraCodes).size).toBeGreaterThanOrEqual(3);
      for (const code of new Set(sacraCodes)) {
        expect(BLUES).toContain(Number(code.match(/(\d+)m$/)[1]));
      }

      const luxCodes = line.slice(luxStart).match(/\u001b\[38;5;\d+m/g);
      expect(luxCodes).toHaveLength(3);
      expect(luxCodes.map((code) => Number(code.match(/(\d+)m$/)[1]))).toEqual(
        GOLD[index]
      );
      expect(line.endsWith("\u001b[0m")).toBe(true);
      expect(stripCodes(line)).toBe(WORDMARK_LINES[index]);
    });
    expect(lines[4]).toContain("\u001b[38;5;74m");
    expect(lines[4]).toContain(pkg.version);
  });

  test("omits color control codes when NO_COLOR is set", () => {
    const { buildStartupBanner } = loadBanner();
    const text = buildStartupBanner({
      version: pkg.version,
      env: { NO_COLOR: "" }
    });

    expect(text).not.toMatch(/\u001b/);
  });

  test("writes the banner only once", () => {
    const { writeStartupBanner } = loadBanner();
    const logs = [];
    const options = {
      stdout: { isTTY: true },
      env: { NO_COLOR: "1" },
      quiet: false,
      version: pkg.version,
      log: (message) => logs.push(message)
    };

    expect(writeStartupBanner(options)).toBe(true);
    expect(writeStartupBanner(options)).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(pkg.version);
  });

  test("does not write the banner when quiet logs are on", () => {
    const { writeStartupBanner } = loadBanner();
    const log = jest.fn();

    const wrote = writeStartupBanner({
      stdout: { isTTY: true },
      env: {},
      quiet: true,
      version: pkg.version,
      log
    });

    expect(wrote).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  test("does not write the banner when stdout is not a terminal", () => {
    const { writeStartupBanner } = loadBanner();
    const log = jest.fn();

    const wrote = writeStartupBanner({
      stdout: { isTTY: false },
      env: {},
      quiet: false,
      version: pkg.version,
      log
    });

    expect(wrote).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
