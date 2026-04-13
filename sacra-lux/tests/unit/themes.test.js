const { DEFAULT_THEME, getTheme, listThemes, themes } = require("../../src/themes");

describe("themes", () => {
  test("returns the requested theme when it exists", () => {
    expect(getTheme("dark")).toBe(themes.dark);
  });

  test("falls back to the default theme for unknown ids", () => {
    expect(getTheme("missing-theme")).toBe(themes[DEFAULT_THEME]);
  });

  test("lists themes as id and label pairs", () => {
    const listed = listThemes();

    expect(listed).toContainEqual({ id: "carmelite", label: "Carmel Light" });
    expect(listed).toContainEqual({ id: "dark", label: "Dark" });
  });
});
