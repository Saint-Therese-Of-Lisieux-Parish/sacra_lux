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

  /**
   * Font names reach the projector through a CSS font-family string, so the
   * pages use one known-Fonts whitelist for the names they render.
   * Returns the exact whitelisted name, or "" for anything else.
   */
  function knownFontName(value, fallback = "") {
    const name = typeof value === "string" ? value : String(value ?? "");
    return VALID_FONT_NAMES.has(name) ? name : fallback;
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
   * Add calendar days to a start time and keep the same local clock time.
   * A local week is not always 168 hours: a daylight saving time change adds
   * or removes one hour. Returns a datetime-local value (YYYY-MM-DDTHH:MM),
   * or "" when the start time is not a valid date.
   */
  function addLocalDays(value, days) {
    const date = new Date(String(value ?? ""));
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + (Number(days) || 0));
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * Play time of one Pre-Mass, Gathering, or Post-Mass organizer item, in
   * seconds. The organizer list, the start preview, the slideshow editor, and
   * the server lead-in all use this one calculation.
   *
   * Crossfades run inside each image interval and add no time. Returns null
   * when the time is not known (a movie).
   *   item: organizer item ({ type, durationSec })
   *   manual: the item's manual slide content, or undefined
   *   slideCount: slides the item produced
   *   playableImageCount: slideshow images that can play; counted from
   *     `manual.images` when omitted
   */
  function itemRuntimeSeconds(item, manual, slideCount, playableImageCount) {
    const type = item?.type;
    if (type === "movie") return null;
    if (type === "imageSlideshow") {
      const imageCount = playableImageCount ?? (Array.isArray(manual?.images)
        ? manual.images.filter((image) => image?.url || typeof image === "string").length
        : 0);
      return slideshowRuntimeSeconds(imageCount, manual?.slideshowDurationSec, manual?.slideshowLoopCount);
    }
    if (type === "countdown") {
      return Math.max(1, Math.min(3600, Number(manual?.countdownSec) || 60));
    }
    return (Number(slideCount) || 0) * Math.max(1, Number(item?.durationSec) || 10);
  }

  /**
   * Settings with the Text-slide font choices (font, size, bold, italic)
   * replaced by the hymn or prayer choices when the slide is one of those.
   */
  function withSlideTypeFont(settings, type) {
    if (!settings || (type !== "hymn" && type !== "prayer")) return settings;
    return {
      ...settings,
      textSlideTextFont: settings[`${type}TextFont`] ?? settings.textSlideTextFont,
      textSlideTextSizePx: settings[`${type}TextSizePx`] ?? settings.textSlideTextSizePx,
      textSlideTextBold: settings[`${type}TextBold`] ?? settings.textSlideTextBold,
      textSlideTextItalic: settings[`${type}TextItalic`] ?? settings.textSlideTextItalic
    };
  }

  /** Play time of an image slideshow: images x seconds per image x loops. */
  function slideshowRuntimeSeconds(imageCount, durationSec, loopCount) {
    const seconds = Math.max(1, Math.min(3600, Math.round(Number(durationSec) || 10)));
    const loops = Math.max(1, Math.min(1000, Math.round(Number(loopCount) || 1)));
    return Math.max(0, Number(imageCount) || 0) * loops * seconds;
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

  const VALID_FONT_NAMES = new Set([
    "Merriweather",
    "Lora",
    "Playfair Display",
    "Cormorant Garamond",
    "EB Garamond",
    "Libre Baskerville",
    "Crimson Pro",
    "Noto Serif",
    "PT Serif",
    "Source Sans 3",
    "Inter",
    "Open Sans",
    "Roboto",
    "Work Sans",
    "Noto Sans",
    "PT Sans",
    "Montserrat",
    "Poppins",
    "Raleway"
  ]);

  return {
    escapeHtml,
    knownFontName,
    formatCountdownTime,
    formatDurationTime,
    addLocalDays,
    itemRuntimeSeconds,
    slideshowRuntimeSeconds,
    withSlideTypeFont,
    imageFileNameLabel,
    slideshowLabelFromFileNames
  };
});
