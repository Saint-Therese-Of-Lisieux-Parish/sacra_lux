const pkg = require("../../package.json");

const WORDMARK_LINES = [
  " ___   _   ___ ___    _     _   _   ___  __",
  "/ __| /_\\ / __| _ \\  /_\\   | | | | | \\ \\/ /",
  "\\__ \\/ _ \\ (__|   / / _ \\  | |_| |_| |>  <",
  "|___/_/ \\_\\___|_|_\\/_/ \\_\\ |____\\___//_/\\_\\"
];

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

  test("keeps each line within 80 characters", () => {
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
        expect(line.length).toBeLessThanOrEqual(80);
      }
    }
  });

  test("paints each wordmark line with three gold tones", () => {
    const { buildStartupBanner } = loadBanner();
    const lines = buildStartupBanner({
      version: pkg.version,
      env: {}
    }).split("\n");

    for (const line of lines.slice(0, 4)) {
      const codes = line.match(/\u001b\[38;5;\d+m/g);
      expect(codes).toHaveLength(3);
      expect(new Set(codes).size).toBeGreaterThanOrEqual(2);
      expect(line.endsWith("\u001b[0m")).toBe(true);
      expect(line.length).toBeLessThanOrEqual(80);
    }
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
