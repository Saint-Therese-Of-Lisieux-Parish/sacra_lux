const { DEFAULT_THEME, getTheme, listThemes, themes } = require("../../src/themes");

const ORDER_THEME_IDS = ["carmelite", "carmeliteDark", "jesuit", "dominican", "franciscan", "benedictine"];
const ON_ACCENT_BACKGROUNDS = [
  "--accent",
  "--accent-2",
  "--tag-pre-bg",
  "--tag-gathering-bg",
  "--tag-mass-bg",
  "--tag-post-bg"
];

// WCAG 2.x relative luminance and contrast ratio for #rrggbb colors.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("themes", () => {
  test("returns the requested theme when it exists", () => {
    expect(getTheme("dark")).toBe(themes.dark);
  });

  test("falls back to the default theme for unknown ids", () => {
    expect(getTheme("missing-theme")).toBe(themes[DEFAULT_THEME]);
  });

  test("lists Catholic themes first with Carmelite themes at the start", () => {
    expect(listThemes()).toEqual([
      { id: "carmelite", label: "Carmel Light" },
      { id: "carmeliteDark", label: "Carmel Dark" },
      { id: "advent", label: "Advent" },
      { id: "lenten", label: "Lenten" },
      { id: "easter", label: "Easter" },
      { id: "marian", label: "Marian" },
      { id: "sacredHeart", label: "Sacred Heart" },
      { id: "sanJuan", label: "San Juan" },
      { id: "jesuit", label: "Jesuit" },
      { id: "dominican", label: "Dominican" },
      { id: "franciscan", label: "Franciscan" },
      { id: "benedictine", label: "Benedictine" },
      { id: "light", label: "Light" },
      { id: "dark", label: "Dark" },
      { id: "rose", label: "Rose" },
      { id: "solarized", label: "Solarized" },
      { id: "ocean", label: "Ocean" },
      { id: "highContrast", label: "High Contrast" },
      { id: "nord", label: "Nord" },
      { id: "monokai", label: "Monokai" },
      { id: "stainedGlass", label: "Stained Glass" },
      { id: "lsuTigers", label: "Geaux Tigers" }
    ]);
  });

  describe.each(ORDER_THEME_IDS)("order theme %s", (id) => {
    const vars = themes[id].vars;

    test("defines the same variables as the light theme", () => {
      expect(Object.keys(vars).sort()).toEqual(Object.keys(themes.light.vars).sort());
    });

    test.each(ON_ACCENT_BACKGROUNDS)("keeps --ink-on-accent readable on %s", (key) => {
      expect(contrast(vars["--ink-on-accent"], vars[key])).toBeGreaterThanOrEqual(4.5);
    });

    test.each(["--bg", "--panel"])("keeps --ink readable on %s", (key) => {
      expect(contrast(vars["--ink"], vars[key])).toBeGreaterThanOrEqual(4.5);
    });
  });
});
