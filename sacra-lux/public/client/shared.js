/**
 * Shared client helpers for the Sacra Lux pages (/app, /screen, /remote).
 *
 * Loaded in the browser via `<script src="/static/client/shared.js">`,
 * which defines the `SacraLuxShared` global. Unit tests import the same
 * file directly with CommonJS `require`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SacraLuxShared = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCountdownTime(totalSeconds) {
    const remainSec = Math.max(0, Number(totalSeconds) || 0);
    if (remainSec < 60) return String(remainSec);
    const mm = Math.floor(remainSec / 60);
    const ss = String(remainSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  return { escapeHtml, formatCountdownTime };
});
