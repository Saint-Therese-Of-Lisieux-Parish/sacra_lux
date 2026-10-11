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

  function formatDurationTime(totalSeconds) {
    const wholeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const mm = Math.floor(wholeSeconds / 60);
    const ss = String(wholeSeconds % 60).padStart(2, "0");
    return `${String(mm).padStart(2, "0")}:${ss}`;
  }

  /**
   * Reduce a file name or URL to a human title: take the last path segment,
   * drop any query/hash and file extension, and decode percent-encoding.
   * Returns "" when no usable name is present.
   */
  function imageFileNameLabel(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized) return "";
    const withoutQuery = normalized.split(/[?#]/, 1)[0];
    const filename = withoutQuery.split("/").pop() || "";
    let decoded = filename;
    try {
      decoded = decodeURIComponent(filename);
    } catch (_error) {
      decoded = filename;
    }
    return decoded.replace(/\.[^.]+$/, "").trim();
  }

  /**
   * Title an image slideshow built from dropped image file names. The first
   * usable name wins because drop order is preserved, so the first file in
   * the drop becomes the slide title.
   */
  function slideshowLabelFromFileNames(fileNames, fallback = "Image Slideshow") {
    const names = Array.isArray(fileNames) ? fileNames : [];
    for (const name of names) {
      const label = imageFileNameLabel(name);
      if (label) return label;
    }
    return fallback;
  }

  return {
    escapeHtml,
    formatCountdownTime,
    formatDurationTime,
    imageFileNameLabel,
    slideshowLabelFromFileNames
  };
});
