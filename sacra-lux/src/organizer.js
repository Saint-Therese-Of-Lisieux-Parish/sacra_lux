const { paginateDocuments } = require("./readingsImporter");

/**
 * Split manual text at hard-break markers (`---` on its own line).
 * Preserve explicit blank segments between consecutive markers.
 * Return one segment per slide.
 */
function splitTextAtHardBreaks(text) {
  const HARD_BREAK = /^\s*---\s*$/;
  const lines = String(text || "").split("\n");
  const segments = [];
  let current = [];

  for (const line of lines) {
    if (HARD_BREAK.test(line)) {
      segments.push(current.join("\n").trim());
      current = [];
    } else if (line.startsWith("R.")) {
      // Give refrain lines their own slide.
      if (current.length > 0) {
        segments.push(current.join("\n").trim());
        current = [];
      }
      segments.push(line.trim());
    } else {
      current.push(line);
    }
  }

  const trailing = current.join("\n").trim();
  if (trailing || segments.length === 0) {
    segments.push(trailing);
  }

  return segments.length > 0 ? segments : [String(text || "")];
}

const SECTION_LABELS = {
  "Reading I": "First Reading",
  "Responsorial Psalm": "Psalm",
  "Reading II": "Second Reading",
  "Reading III": "Third Reading",
  "Reading IV": "Fourth Reading",
  "Reading V": "Fifth Reading",
  "Reading VI": "Sixth Reading",
  "Reading VII": "Seventh Reading",
  "Epistle": "Epistle",
  "Verse Before the Gospel": "Alleluia",
  "Gospel": "Gospel"
};

const VALID_TYPES = ["reading", "image", "imageSlideshow", "movie", "text", "prayer", "hymn", "countdown", "interstitial"];
const VALID_PHASES = ["pre", "gathering", "mass", "post"];
const VALID_BACKGROUND_THEMES = ["dark", "light"];
const VALID_COUNTDOWN_STYLES = ["ring", "digits", "bar", "minimal", "hourglass", "stopwatch"];
const STYLE_OVERRIDE_BOOLEAN_KEYS = ["bold", "italic", "outline", "shadow"];

function normalizePhase(value) {
  if (value === "warmup") return "gathering";
  return VALID_PHASES.includes(value) ? value : "mass";
}

function normalizeBackgroundTheme(value, slideType) {
  if (value === "word") return "dark";
  if (value === "graphic") return "light";
  if (value === "color") return "dark";
  if (value === "image") return "light";
  if (VALID_BACKGROUND_THEMES.includes(value)) return value;
  // Choose the default background from the slide type.
  return (slideType === "image" || slideType === "imageSlideshow" || slideType === "interstitial" || slideType === "movie") ? "light" : "dark";
}

function normalizeType(value) {
  // Migrate legacy type names.
  if (value === "reading-group") return "reading";
  if (value === "graphic") return "image";
  return VALID_TYPES.includes(value) ? value : "text";
}

function normalizeCountdownStyle(value) {
  return VALID_COUNTDOWN_STYLES.includes(value) ? value : "ring";
}

function normalizeCountdownSizePercent(value) {
  return Math.max(50, Math.min(200, Number(value) || 100));
}

function slideshowImageName(entry) {
  const explicitName = typeof entry?.name === "string" ? entry.name.trim() : "";
  if (explicitName) return explicitName;
  const url = typeof entry === "string" ? entry : entry?.url;
  const withoutQuery = String(url || "").split(/[?#]/, 1)[0];
  const filename = withoutQuery.split("/").pop() || "Image";
  try {
    return decodeURIComponent(filename) || "Image";
  } catch (_error) {
    return filename || "Image";
  }
}

function normalizeSlideshowImages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((entry) => {
    const url = typeof entry === "string" ? entry : entry?.url;
    return {
      url: typeof url === "string" ? url.trim() : "",
      name: slideshowImageName(entry)
    };
  });
}

function normalizeSlideshowDurationSec(value) {
  return Math.max(1, Math.min(3600, Math.round(Number(value) || 10)));
}

function normalizeSlideshowLoopCount(value) {
  return Math.max(1, Math.min(1000, Math.round(Number(value) || 1)));
}

const IMAGE_SLIDESHOW_FADE_MS = 700;

/**
 * Total play time of an Image Slideshow: every shown image plus the crossfade
 * between consecutive images (the last image hands off without a fade).
 */
function imageSlideshowRuntimeMs(manualSlide, transition) {
  const imageCount = normalizeSlideshowImages(manualSlide?.images).filter((image) => image.url).length;
  const shownCount = imageCount * normalizeSlideshowLoopCount(manualSlide?.slideshowLoopCount);
  const fadeMs = transition === "none" ? 0 : IMAGE_SLIDESHOW_FADE_MS;
  return shownCount * normalizeSlideshowDurationSec(manualSlide?.slideshowDurationSec) * 1000 +
    Math.max(0, shownCount - 1) * fadeMs;
}

function normalizeStyleOverrides(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalized = {};
  const fontFamily = typeof input.fontFamily === "string" ? input.fontFamily.trim() : "";
  if (fontFamily) {
    normalized.fontFamily = fontFamily;
  }

  const fontSizePx = Number(input.fontSizePx);
  if (Number.isFinite(fontSizePx) && fontSizePx > 0) {
    normalized.fontSizePx = Math.min(200, Math.max(24, Math.round(fontSizePx)));
  }

  for (const key of STYLE_OVERRIDE_BOOLEAN_KEYS) {
    if (typeof input[key] === "boolean") {
      normalized[key] = input[key];
    }
  }

  return normalized;
}

function displayLabelForDocument(doc) {
  const section = String(doc.section || "");
  const splitAt = section.indexOf(" (");
  const base = splitAt === -1 ? section : section.slice(0, splitAt);
  const suffix = splitAt === -1 ? "" : section.slice(splitAt);
  const label = SECTION_LABELS[base];
  return label ? `${label}${suffix}` : section;
}

function createManualSlideRecord(type = "image") {
  if (type === "imageSlideshow") {
    return {
      text: "",
      notes: "",
      textVAlign: null,
      imageUrl: null,
      images: [],
      slideshowDurationSec: 10,
      slideshowLoopCount: 1,
      styleOverrides: {}
    };
  }

  if (type === "text" || type === "prayer" || type === "hymn") {
    return {
      text: "",
      notes: "",
      textVAlign: "middle",
      imageUrl: null,
      styleOverrides: {}
    };
  }

  if (type === "countdown") {
    return {
      text: "",
      notes: "",
      textVAlign: null,
      imageUrl: null,
      countdownSec: 60,
      countdownFont: "",
      countdownStyle: "ring",
      countdownSizePercent: 100,
      styleOverrides: {}
    };
  }

  if (type === "movie") {
    return {
      text: "",
      notes: "",
      textVAlign: null,
      imageUrl: null,
      videoUrl: null,
      videoLoop: false,
      videoAutoAdvance: true,
      styleOverrides: {}
    };
  }

  return {
    text: "",
    notes: "",
    textVAlign: null,
    imageUrl: null,
    styleOverrides: {}
  };
}

function createDefaultOrganizer(documents) {
  const sequence = [];
  const manualSlides = {};

  documents.forEach((doc, index) => {
    const readingId = `reading:${doc.stem}`;
    sequence.push({
      id: readingId,
      type: "reading",
      sourceStem: doc.stem,
      label: displayLabelForDocument(doc),
      phase: "mass",
      backgroundTheme: "dark"
    });

    if (index < documents.length - 1) {
      const imageId = `image:${doc.stem}:${index + 1}`;
      sequence.push({
        id: imageId,
        type: "image",
        label: "Image",
        phase: "mass",
        backgroundTheme: "light"
      });
      manualSlides[imageId] = createManualSlideRecord("image");
    }
  });

  return { sequence, manualSlides };
}

function buildManualSlide(item, manualSlide, index) {
  const rawText = manualSlide?.text || "";
  const baseProps = {
    organizerItemId: item.id,
    type: item.type,
    notes: manualSlide?.notes || "",
    textVAlign: manualSlide?.textVAlign || "middle",
    imageUrl: manualSlide?.imageUrl || null,
    styleOverrides: normalizeStyleOverrides(manualSlide?.styleOverrides),
    phase: normalizePhase(item.phase),
    backgroundTheme: normalizeBackgroundTheme(item.backgroundTheme, item.type),
    index
  };

  if (item.type === "imageSlideshow") {
    const images = normalizeSlideshowImages(manualSlide?.images);
    const durationSec = normalizeSlideshowDurationSec(manualSlide?.slideshowDurationSec);
    const loopCount = normalizeSlideshowLoopCount(manualSlide?.slideshowLoopCount);
    const slideshowBase = {
      ...baseProps,
      title: item.label || "Image Slideshow",
      text: "",
      slideshowDurationSec: durationSec,
      slideshowLoopCount: loopCount,
      slideshowImageCount: images.length,
      totalPages: Math.max(1, images.length)
    };

    if (images.length === 0) {
      return [{
        ...slideshowBase,
        id: `${item.id}:1`,
        imageUrl: null,
        slideshowImageName: null,
        slideshowImageIndex: 0,
        slideshowEmpty: true,
        pageNumber: 1,
        isFirstPage: true,
        isLastPage: true
      }];
    }

    return images.map((image, imageIndex) => ({
      ...slideshowBase,
      id: `${item.id}:${imageIndex + 1}`,
      imageUrl: image.url || null,
      slideshowImageName: image.name,
      slideshowImageIndex: imageIndex,
      slideshowEmpty: false,
      pageNumber: imageIndex + 1,
      isFirstPage: imageIndex === 0,
      isLastPage: imageIndex === images.length - 1
    }));
  }

  // Do not split image, interstitial, or movie slides.
  if (item.type === "image" || item.type === "interstitial" || item.type === "movie") {
    return [{
      ...baseProps,
      id: `${item.id}:1`,
      title: item.label || (item.type === "interstitial" ? "Interstitial" : item.type === "movie" ? "Movie" : "Image"),
      text: rawText,
      videoUrl: manualSlide?.videoUrl || null,
      videoLoop: Boolean(manualSlide?.videoLoop),
      videoAutoAdvance: manualSlide?.videoAutoAdvance !== false,
      pageNumber: 1,
      totalPages: 1,
      isFirstPage: true,
      isLastPage: true
    }];
  }

  // Keep countdown slides as a single slide.
  if (item.type === "countdown") {
    return [{
      ...baseProps,
      id: `${item.id}:1`,
      title: item.label || "Countdown",
      text: "",
      countdownSec: Math.max(1, Math.min(300, Number(manualSlide?.countdownSec) || 60)),
      countdownFont: manualSlide?.countdownFont || "",
      countdownStyle: normalizeCountdownStyle(manualSlide?.countdownStyle),
      countdownSizePercent: normalizeCountdownSizePercent(manualSlide?.countdownSizePercent),
      countdownShowLabel: false,
      pageNumber: 1,
      totalPages: 1,
      isFirstPage: true,
      isLastPage: true
    }];
  }

  // Split text, prayer, and hymn slides at hard-break markers.
  const pages = splitTextAtHardBreaks(rawText);
  const totalPages = pages.length;
  const typeLabel = item.type.charAt(0).toUpperCase() + item.type.slice(1);

  return pages.map((pageText, i) => ({
    ...baseProps,
    id: `${item.id}:${i + 1}`,
    title: totalPages > 1
      ? `${item.label || typeLabel} (${i + 1}/${totalPages})`
      : (item.label || typeLabel),
    text: pageText,
    pageNumber: i + 1,
    totalPages,
    isFirstPage: i === 0,
    isLastPage: i === pages.length - 1
  }));
}

function buildReadingSlides(item, documents, screenSettings) {
  const doc = documents.find((entry) => entry.stem === item.sourceStem);
  if (!doc) {
    return [];
  }

  const styleOverrides = normalizeStyleOverrides(item.styleOverrides);
  const effectiveScreenSettings = {
    ...screenSettings,
    ...(styleOverrides.fontFamily ? { readingTextFont: styleOverrides.fontFamily } : {}),
    ...(styleOverrides.fontSizePx ? { readingTextSizePx: styleOverrides.fontSizePx } : {}),
    ...(typeof styleOverrides.bold === "boolean" ? { readingTextBold: styleOverrides.bold } : {}),
    ...(typeof styleOverrides.italic === "boolean" ? { readingTextItalic: styleOverrides.italic } : {}),
    ...(typeof styleOverrides.outline === "boolean" ? { readingTextOutline: styleOverrides.outline } : {}),
    ...(typeof styleOverrides.shadow === "boolean" ? { readingTextShadow: styleOverrides.shadow } : {})
  };

  const paginated = paginateDocuments([doc], {
    fontSizePx: effectiveScreenSettings.fontSizePx,
    fontFamily: effectiveScreenSettings.fontFamily,
    readingTextHeightPx: effectiveScreenSettings.readingTextHeightPx,
    readingTextSizePx: effectiveScreenSettings.readingTextSizePx,
    readingLineHeight: effectiveScreenSettings.readingLineHeight,
    readingTextMarginXPx: effectiveScreenSettings.readingTextMarginXPx
  });

  return paginated.map((slide) => ({
    ...slide,
    organizerItemId: item.id,
    styleOverrides,
    groupLabel: item.label || displayLabelForDocument(doc),
    title:
      slide.totalPages > 1
        ? `${item.label || displayLabelForDocument(doc)} — ${slide.passage} (${slide.pageNumber}/${slide.totalPages})`
        : `${item.label || displayLabelForDocument(doc)} — ${slide.passage}`,
    phase: normalizePhase(item.phase),
    backgroundTheme: normalizeBackgroundTheme(item.backgroundTheme, item.type)
  }));
}

function buildPresentationFromOrganizer({
  title,
  documents,
  sequence,
  manualSlides,
  screenSettings
}) {
  const slides = [];

  for (const item of sequence) {
    if (item.type === "reading") {
      slides.push(...buildReadingSlides(item, documents, screenSettings));
      continue;
    }

    if (VALID_TYPES.includes(item.type) && item.type !== "reading") {
      const built = buildManualSlide(item, manualSlides[item.id], slides.length);
      slides.push(...built);
    }
  }

  slides.forEach((slide, index) => {
    slide.index = index;
  });

  return {
    title: title || "Mass Presentation",
    sourceFile: null,
    slides
  };
}

module.exports = {
  createDefaultOrganizer,
  buildPresentationFromOrganizer,
  displayLabelForDocument,
  normalizeBackgroundTheme,
  normalizePhase,
  normalizeType,
  normalizeStyleOverrides,
  normalizeCountdownStyle,
  normalizeCountdownSizePercent,
  normalizeSlideshowImages,
  normalizeSlideshowDurationSec,
  normalizeSlideshowLoopCount,
  imageSlideshowRuntimeMs,
  IMAGE_SLIDESHOW_FADE_MS,
  VALID_COUNTDOWN_STYLES,
  createManualSlideRecord
};
