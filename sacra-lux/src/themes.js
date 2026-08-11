/**
 * App UI theme definitions.
 * Load theme data from themes.json and expose lookup helpers.
 */
const themes = require("./themes.json");

const DEFAULT_THEME = "carmelite";
const CATHOLIC_THEME_IDS = Object.freeze([
  "carmelite",
  "carmeliteDark",
  "advent",
  "lenten",
  "easter",
  "marian",
  "sacredHeart",
  "sanJuan",
  "jesuit",
  "dominican",
  "franciscan",
  "benedictine"
]);
const CATHOLIC_THEME_ID_SET = new Set(CATHOLIC_THEME_IDS);

function getTheme(name) {
  return themes[name] || themes[DEFAULT_THEME];
}

function listThemeEntries() {
  return [
    ...CATHOLIC_THEME_IDS.map((id) => [id, themes[id]]),
    ...Object.entries(themes).filter(([id]) => !CATHOLIC_THEME_ID_SET.has(id))
  ];
}

function listThemes() {
  return listThemeEntries().map(([id, t]) => ({ id, label: t.label }));
}

module.exports = { themes, DEFAULT_THEME, getTheme, listThemeEntries, listThemes };
