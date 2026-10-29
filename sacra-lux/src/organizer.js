const { slideshowRuntimeSeconds } = require("../public/client/shared.js");
const { paginateDocuments, estimateVisualLines } = require("./readingsImporter");
const {
  boundsToRect,
  legacyTextBoundsFromSettings,
  normalizeGroupBounds,
  normalizeTextBounds
} = require("./textBounds");

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
const COUNTDOWN_MIN_SEC = 1;
const COUNTDOWN_MAX_SEC = 3600;
const VALID_COUNTDOWN_STYLES = ["ring", "digits", "bar", "minimal", "hourglass", "stopwatch"];
const VALID_COUNTDOWN_FONTS = new Set([
  "Merriweather", "Lora", "Playfair Display", "Cormorant Garamond", "EB Garamond",
  "Libre Baskerville", "Crimson Pro", "Noto Serif", "PT Serif", "Source Sans 3",
  "Inter", "Open Sans", "Roboto", "Work Sans", "Noto Sans", "PT Sans",
  "Montserrat", "Poppins", "Raleway"
]);
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

function normalizeCountdownSec(value) {
  return Math.max(COUNTDOWN_MIN_SEC, Math.min(COUNTDOWN_MAX_SEC, Number(value) || 60));
}

// Returns an error message for a countdown length outside the allowed range.
// An absent value is allowed and falls back to the default length.
function countdownSecError(value) {
  if (value === undefined || value === null || value === "") return "";
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < COUNTDOWN_MIN_SEC || seconds > COUNTDOWN_MAX_SEC) {
    return `Countdown must be between ${COUNTDOWN_MIN_SEC} second and ${COUNTDOWN_MAX_SEC / 60} minutes.`;
  }
  return "";
}

function normalizeCountdownStyle(value) {
  return VALID_COUNTDOWN_STYLES.includes(value) ? value : "ring";
}

function normalizeCountdownSizePercent(value) {
  return Math.max(50, Math.min(200, Number(value) || 100));
}

function normalizeCountdownFont(value) {
  const name = typeof value === "string" ? value : "";
  return VALID_COUNTDOWN_FONTS.has(name) ? name : "";
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
 * Total play time of an Image Slideshow. Crossfades run inside each image
 * interval and do not add time to the slideshow.
 */
function imageSlideshowRuntimeMs(manualSlide) {
  const imageCount = normalizeSlideshowImages(manualSlide?.images).filter((image) => image.url).length;
  return slideshowRuntimeSeconds(imageCount, manualSlide?.slideshowDurationSec, manualSlide?.slideshowLoopCount) * 1000;
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

  const bounds = normalizeGroupBounds(input.bounds);
  if (bounds) {
    normalized.bounds = bounds;
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

// eslint-disable-next-line security/detect-unsafe-regex -- one lazy group with a fixed suffix, so matching is linear; input is a file stem
const ALTERNATE_STEM = /^(.+?)[-_]alternate(?:[-_]\d+)?$/i;

// Group each base reading with its alternates, for example Gospel and Gospel-alternate_1.
// Only groups that hold at least one alternate are returned.
function findAlternateGroups(documents) {
  const groups = new Map();
  for (const doc of documents || []) {
    const match = ALTERNATE_STEM.exec(doc.stem);
    const key = match ? match[1] : doc.stem;
    if (!groups.has(key)) groups.set(key, { key, base: null, alternates: [] });
    const group = groups.get(key);
    if (match) group.alternates.push(doc.stem);
    else group.base = doc.stem;
  }
  return [...groups.values()]
    .filter((group) => group.alternates.length > 0)
    .map((group) => ({
      key: group.key,
      options: [group.base, ...group.alternates].filter(Boolean)
    }));
}

// Remove the documents that the operator did not select from each alternate group.
// A group with no selection keeps its base reading. Unselected files stay on disk.
function selectAlternateDocuments(documents, selections = {}) {
  const dropped = new Set();
  for (const group of findAlternateGroups(documents)) {
    const chosen = group.options.includes(selections[group.key]) ? selections[group.key] : group.options[0];
    group.options.filter((stem) => stem !== chosen).forEach((stem) => dropped.add(stem));
  }
  return (documents || []).filter((doc) => !dropped.has(doc.stem));
}

function createDefaultOrganizer(allDocuments, { alternateSelections } = {}) {
  const documents = alternateSelections
    ? selectAlternateDocuments(allDocuments, alternateSelections)
    : allDocuments;
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

// Rename generated items whose IDs collide with existing IDs, so inserts keep every ID unique.
function dedupeOrganizerIds(sequence, manualSlides, takenIds) {
  const used = new Set(takenIds);
  const renamed = new Map();
  const nextSequence = sequence.map((item) => {
    let id = item.id;
    for (let n = 2; used.has(id); n += 1) {
      id = `${item.id}~${n}`;
    }
    used.add(id);
    renamed.set(item.id, id);
    return id === item.id ? item : { ...item, id };
  });
  const nextManualSlides = {};
  for (const [id, record] of Object.entries(manualSlides)) {
    nextManualSlides[renamed.get(id) || id] = record;
  }
  return { sequence: nextSequence, manualSlides: nextManualSlides };
}

/**
 * Split one page of text so each part fits the text box.
 * Prefer a blank line between stanzas as the split point.
 * Keep a single line that is too long on its own page.
 */
function splitTextToFit(text, maxVisualLines, fontSizePx, boxWidthPx) {
  const lines = String(text || "").split("\n");
  const cost = (line) => estimateVisualLines(line, fontSizePx, boxWidthPx);
  if (lines.reduce((sum, line) => sum + cost(line), 0) <= maxVisualLines) return [text];

  const pages = [];
  let current = [];
  let used = 0;
  let lastBlank = -1;
  const flush = (end) => {
    const page = current.slice(0, end).join("\n").trim();
    if (page) pages.push(page);
    current = current.slice(end);
    while (current.length && current[0].trim() === "") current.shift();
    used = current.reduce((sum, line) => sum + cost(line), 0);
    lastBlank = -1;
  };

  for (const line of lines) {
    const lineCost = cost(line);
    if (used + lineCost > maxVisualLines && current.some((l) => l.trim() !== "")) {
      flush(lastBlank > 0 ? lastBlank : current.length);
    }
    if (line.trim() === "" && current.length === 0) continue;
    if (line.trim() === "") lastBlank = current.length;
    current.push(line);
    used += lineCost;
  }
  flush(current.length);
  return pages.length ? pages : [text];
}

function textPagesForSettings(item, manualSlide, pages, screenSettings) {
  if (!screenSettings || !["text", "prayer", "hymn"].includes(item.type)) return pages;
  const overrides = normalizeStyleOverrides(manualSlide?.styleOverrides);
  const typeSize = Number(screenSettings[`${item.type}TextSizePx`] ?? screenSettings.textSlideTextSizePx);
  const sizePx = overrides.fontSizePx || typeSize || Number(screenSettings.fontSizePx) || 60;
  const lineHeight = Number(screenSettings.textSlideLineHeight) || 1.55;
  const textBounds = normalizeTextBounds(
    screenSettings.textBounds || legacyTextBoundsFromSettings(screenSettings)
  );
  const rect = boundsToRect(
    overrides.bounds?.body || textBounds[item.type],
    screenSettings.resolution || "1080p"
  );
  const maxLines = Math.max(1, Math.floor(rect.height / (sizePx * lineHeight)));
  return pages.flatMap((page) => splitTextToFit(page, maxLines, sizePx, rect.width));
}

function buildManualSlide(item, manualSlide, index, screenSettings) {
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
      countdownSec: normalizeCountdownSec(manualSlide?.countdownSec),
      countdownFont: normalizeCountdownFont(manualSlide?.countdownFont),
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
  const pages = textPagesForSettings(item, manualSlide, splitTextAtHardBreaks(rawText), screenSettings);
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

const RESOLUTION_CANVAS_WIDTHS = {
  "720p": 1280,
  "1080p": 1920,
  "1440p": 2560,
  "4k": 3840
};

function buildReadingSlides(item, documents, screenSettings) {
  const doc = documents.find((entry) => entry.stem === item.sourceStem);
  if (!doc) {
    return [];
  }

  const styleOverrides = normalizeStyleOverrides(item.styleOverrides);
  const globalTextBounds = normalizeTextBounds(
    screenSettings.textBounds || legacyTextBoundsFromSettings(screenSettings)
  );
  const effectiveTextBounds = {
    ...globalTextBounds,
    readingBody: styleOverrides.bounds?.body || globalTextBounds.readingBody,
    readingPassage: styleOverrides.bounds?.passage || globalTextBounds.readingPassage
  };
  const effectiveScreenSettings = {
    ...screenSettings,
    textBounds: effectiveTextBounds,
    ...(styleOverrides.fontFamily ? { readingTextFont: styleOverrides.fontFamily } : {}),
    ...(styleOverrides.fontSizePx ? { readingTextSizePx: styleOverrides.fontSizePx } : {}),
    ...(typeof styleOverrides.bold === "boolean" ? { readingTextBold: styleOverrides.bold } : {}),
    ...(typeof styleOverrides.italic === "boolean" ? { readingTextItalic: styleOverrides.italic } : {}),
    ...(typeof styleOverrides.outline === "boolean" ? { readingTextOutline: styleOverrides.outline } : {}),
    ...(typeof styleOverrides.shadow === "boolean" ? { readingTextShadow: styleOverrides.shadow } : {})
  };
  const readingRect = boundsToRect(
    effectiveTextBounds.readingBody,
    effectiveScreenSettings.resolution || "1080p"
  );

  const paginated = paginateDocuments([doc], {
    fontSizePx: effectiveScreenSettings.fontSizePx,
    fontFamily: effectiveScreenSettings.fontFamily,
    readingTextHeightPx: readingRect.height,
    readingTextWidthPx: readingRect.width,
    readingTextSizePx: effectiveScreenSettings.readingTextSizePx,
    readingLineHeight: effectiveScreenSettings.readingLineHeight,
    readingTextMarginXPx: effectiveScreenSettings.readingTextMarginXPx,
    canvasWidth: RESOLUTION_CANVAS_WIDTHS[effectiveScreenSettings.resolution] || RESOLUTION_CANVAS_WIDTHS["1080p"],
    readingTextFont: effectiveScreenSettings.readingTextFont,
    readingTextBold: effectiveScreenSettings.readingTextBold,
    readingTextItalic: effectiveScreenSettings.readingTextItalic,
    readingLetterSpacingPx: effectiveScreenSettings.readingLetterSpacingPx,
    psalmRefrainIndex: item.psalmRefrainIndex,
    readingShowEnding: effectiveScreenSettings.readingShowEnding
  });

  return paginated.map((slide) => ({
    ...slide,
    organizerItemId: item.id,
    styleOverrides,
    groupLabel: item.label || displayLabelForDocument(doc),
    title: readingSlideTitle(item.label || displayLabelForDocument(doc), slide),
    phase: normalizePhase(item.phase),
    backgroundTheme: normalizeBackgroundTheme(item.backgroundTheme, item.type)
  }));
}

function readingSlideTitle(label, slide) {
  const base = `${label} — ${slide.passage}`;
  if (slide.isEndingSlide) return `${base} (Ending)`;
  return slide.totalPages > 1 ? `${base} (${slide.pageNumber}/${slide.totalPages})` : base;
}

function buildPresentationFromOrganizer({
  title,
  documents,
  sequence,
  manualSlides,
  screenSettings
}) {
  const slides = [];
  const usedSlideIds = new Set();

  function appendUniqueSlides(newSlides) {
    for (const slide of newSlides) {
      const originalId = String(slide.id || "slide");
      let uniqueId = originalId;
      let duplicateNumber = 2;
      while (usedSlideIds.has(uniqueId)) {
        uniqueId = `${originalId}~${slide.organizerItemId || "duplicate"}~${duplicateNumber}`;
        duplicateNumber += 1;
      }
      if (uniqueId !== slide.id) slide.id = uniqueId;
      usedSlideIds.add(uniqueId);
      slides.push(slide);
    }
  }

  for (const item of sequence) {
    if (item.type === "reading") {
      appendUniqueSlides(buildReadingSlides(item, documents, screenSettings));
      continue;
    }

    if (VALID_TYPES.includes(item.type) && item.type !== "reading") {
      const built = buildManualSlide(item, manualSlides[item.id], slides.length, screenSettings);
      appendUniqueSlides(built);
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
  VALID_PHASES,
  createDefaultOrganizer,
  dedupeOrganizerIds,
  findAlternateGroups,
  selectAlternateDocuments,
  buildPresentationFromOrganizer,
  displayLabelForDocument,
  normalizeBackgroundTheme,
  normalizePhase,
  normalizeType,
  normalizeStyleOverrides,
  normalizeCountdownStyle,
  normalizeCountdownSec,
  countdownSecError,
  COUNTDOWN_MAX_SEC,
  normalizeCountdownSizePercent,
  normalizeSlideshowImages,
  normalizeSlideshowDurationSec,
  normalizeSlideshowLoopCount,
  imageSlideshowRuntimeMs,
  IMAGE_SLIDESHOW_FADE_MS,
  VALID_COUNTDOWN_STYLES,
  normalizeCountdownFont,
  createManualSlideRecord
};
