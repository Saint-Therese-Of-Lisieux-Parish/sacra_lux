const themes = require("../../src/themes.json");

function luminance(hex) {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value || "");

describe("theme text contrast", () => {
  const entries = Object.entries(themes);

  test.each(entries)("%s body and soft text meet 4.5:1 on its surfaces", (id, theme) => {
    const vars = theme.vars;
    const surfaces = ["--panel", "--panel-alt", "--bg", "--bg-alt"].filter((key) => isHex(vars[key]));
    for (const textVar of ["--ink", "--ink-soft"]) {
      for (const surface of surfaces) {
        expect({ id, textVar, surface, ratio: contrast(vars[textVar], vars[surface]) >= 4.5 })
          .toEqual({ id, textVar, surface, ratio: true });
      }
    }
  });
});

describe("theme accent and danger text contrast", () => {
  test.each(Object.entries(themes))("%s accent and danger text meet 4.5:1", (id, theme) => {
    const vars = theme.vars;
    const surfaces = ["--panel", "--panel-alt", "--bg", "--bg-alt", "--active-bg", "--pressed-bg"].filter((key) => isHex(vars[key]));
    for (const textVar of ["--accent-text", "--danger-text"]) {
      expect(isHex(vars[textVar])).toBe(true);
      for (const surface of surfaces) {
        expect({ id, textVar, surface, ok: contrast(vars[textVar], vars[surface]) >= 4.5 })
          .toEqual({ id, textVar, surface, ok: true });
      }
    }
  });
});

describe("theme button text contrast", () => {
  test.each(Object.entries(themes))("%s button text meets 4.5:1 on accent fills", (id, theme) => {
    const vars = theme.vars;
    for (const fill of ["--accent", "--accent-2", "--danger"].filter((key) => isHex(vars[key]))) {
      expect({ id, fill, ok: contrast(vars["--ink-on-accent"], vars[fill]) >= 4.5 })
        .toEqual({ id, fill, ok: true });
    }
  });
});
