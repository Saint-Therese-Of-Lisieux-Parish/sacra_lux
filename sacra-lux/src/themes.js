/**
 * App UI theme definitions.
 * Load theme data from themes.json and expose lookup helpers.
 */
const themes = require("./themes.json");

const DEFAULT_THEME = "carmelite";

function getTheme(name) {
  return themes[name] || themes[DEFAULT_THEME];
}

function listThemes() {
  return Object.entries(themes).map(([id, t]) => ({ id, label: t.label }));
}

module.exports = { themes, DEFAULT_THEME, getTheme, listThemes };
