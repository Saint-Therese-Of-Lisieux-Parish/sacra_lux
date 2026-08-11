const { DEFAULT_THEME, getTheme, listThemes, themes } = require("../../src/themes");

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
});
