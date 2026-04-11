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
  "Verse Before the Gospel": "Alleluia",
  "Gospel": "Gospel"
};

const VALID_TYPES = ["reading", "image", "text", "prayer", "hymn", "countdown", "interstitial"];
const VALID_PHASES = ["pre", "gathering", "mass", "post"];
const VALID_BACKGROUND_THEMES = ["dark", "light"];

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
  return (slideType === "image" || slideType === "interstitial") ? "light" : "dark";
}

function normalizeType(value) {
  // Migrate legacy type names.
  if (value === "reading-group") return "reading";
  if (value === "graphic") return "image";
  return VALID_TYPES.includes(value) ? value : "text";
}

function displayLabelForDocument(doc) {
  return SECTION_LABELS[doc.section] || doc.section;
}

function createManualSlideRecord(type = "image") {
  if (type === "text" || type === "prayer" || type === "hymn") {
    return {
      text: "",
      notes: "",
      textVAlign: "middle",
      imageUrl: null
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
      countdownShowLabel: true
    };
  }

  return {
    text: "",
    notes: "",
    textVAlign: null,
    imageUrl: null
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
    phase: normalizePhase(item.phase),
    backgroundTheme: normalizeBackgroundTheme(item.backgroundTheme, item.type),
    index
  };

  // Do not split image or interstitial slides.
  if (item.type === "image" || item.type === "interstitial") {
    return [{
      ...baseProps,
      id: `${item.id}:1`,
      title: item.label || (item.type === "interstitial" ? "Interstitial" : "Image"),
      text: rawText,
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
      countdownShowLabel: manualSlide?.countdownShowLabel !== false,
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

  const paginated = paginateDocuments([doc], {
    fontSizePx: screenSettings.fontSizePx,
    fontFamily: screenSettings.fontFamily,
    readingTextHeightPx: screenSettings.readingTextHeightPx,
    readingTextSizePx: screenSettings.readingTextSizePx,
    readingLineHeight: screenSettings.readingLineHeight,
    readingTextMarginXPx: screenSettings.readingTextMarginXPx
  });

  return paginated.map((slide) => ({
    ...slide,
    organizerItemId: item.id,
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
  createManualSlideRecord
};
