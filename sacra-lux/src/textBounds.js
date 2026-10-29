const REFERENCE_CANVAS = Object.freeze({ width: 1920, height: 1080 });
const MIN_BOX = Object.freeze({ width: 120, height: 80 });

const RESOLUTION_CANVASES = Object.freeze({
  "720p": Object.freeze({ width: 1280, height: 720 }),
  "1080p": REFERENCE_CANVAS,
  "1440p": Object.freeze({ width: 2560, height: 1440 }),
  "4k": Object.freeze({ width: 3840, height: 2160 })
});

const DEFAULT_TEXT_BOUNDS = Object.freeze({
  readingBody: Object.freeze({ left: 80, right: 80, top: 130, bottom: 110 }),
  readingPassage: Object.freeze({ left: 80, right: 1190, top: 70, bottom: 908 }),
  hymn: Object.freeze({ left: 110, right: 110, top: 90, bottom: 90 }),
  prayer: Object.freeze({ left: 110, right: 110, top: 90, bottom: 90 }),
  text: Object.freeze({ left: 110, right: 110, top: 90, bottom: 90 })
});

const TEXT_BOUND_KEYS = Object.freeze(Object.keys(DEFAULT_TEXT_BOUNDS));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numericEdge(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeBounds(input, fallback = DEFAULT_TEXT_BOUNDS.text) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const safeFallback = fallback && typeof fallback === "object" ? fallback : DEFAULT_TEXT_BOUNDS.text;
  const left = clamp(numericEdge(source.left, safeFallback.left), 0, REFERENCE_CANVAS.width - MIN_BOX.width);
  let right = clamp(numericEdge(source.right, safeFallback.right), 0, REFERENCE_CANVAS.width - MIN_BOX.width);
  const top = clamp(numericEdge(source.top, safeFallback.top), 0, REFERENCE_CANVAS.height - MIN_BOX.height);
  let bottom = clamp(numericEdge(source.bottom, safeFallback.bottom), 0, REFERENCE_CANVAS.height - MIN_BOX.height);

  if (REFERENCE_CANVAS.width - left - right < MIN_BOX.width) {
    right = Math.max(0, REFERENCE_CANVAS.width - left - MIN_BOX.width);
  }
  if (REFERENCE_CANVAS.height - top - bottom < MIN_BOX.height) {
    bottom = Math.max(0, REFERENCE_CANVAS.height - top - MIN_BOX.height);
  }

  return { left, right, top, bottom };
}

function normalizeTextBounds(input, fallback = DEFAULT_TEXT_BOUNDS) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fallbackSource = fallback && typeof fallback === "object" && !Array.isArray(fallback)
    ? fallback
    : DEFAULT_TEXT_BOUNDS;
  const normalized = {};
  for (const key of TEXT_BOUND_KEYS) {
    normalized[key] = normalizeBounds(source[key], fallbackSource[key] || DEFAULT_TEXT_BOUNDS[key]);
  }
  return normalized;
}

function normalizeGroupBounds(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const normalized = {};
  if (input.body && typeof input.body === "object" && !Array.isArray(input.body)) {
    normalized.body = normalizeBounds(input.body, DEFAULT_TEXT_BOUNDS.text);
  }
  if (input.passage && typeof input.passage === "object" && !Array.isArray(input.passage)) {
    normalized.passage = normalizeBounds(input.passage, DEFAULT_TEXT_BOUNDS.readingPassage);
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function canvasForResolution(resolution) {
  return RESOLUTION_CANVASES[resolution] || RESOLUTION_CANVASES["1080p"];
}

function scaleBounds(bounds, resolution) {
  const normalized = normalizeBounds(bounds);
  const canvas = canvasForResolution(resolution);
  const scaleX = canvas.width / REFERENCE_CANVAS.width;
  const scaleY = canvas.height / REFERENCE_CANVAS.height;
  return {
    left: normalized.left * scaleX,
    right: normalized.right * scaleX,
    top: normalized.top * scaleY,
    bottom: normalized.bottom * scaleY
  };
}

function boundsToRect(bounds, resolution = "1080p") {
  const canvas = canvasForResolution(resolution);
  const scaled = scaleBounds(bounds, resolution);
  return {
    left: scaled.left,
    top: scaled.top,
    width: canvas.width - scaled.left - scaled.right,
    height: canvas.height - scaled.top - scaled.bottom
  };
}

function textBoundsToLegacySettings(textBounds, resolution = "1080p") {
  const normalized = normalizeTextBounds(textBounds);
  const readingBody = boundsToRect(normalized.readingBody, resolution);
  const readingPassage = boundsToRect(normalized.readingPassage, resolution);
  const text = boundsToRect(normalized.text, resolution);
  return {
    readingTextMarginXPx: readingBody.left,
    readingTextMarginYPx: readingBody.top,
    readingTextHeightPx: readingBody.height,
    readingPassageYPx: readingPassage.top,
    readingPassageWidthPx: readingPassage.width,
    textSlideMarginXPx: text.left,
    textSlideMarginYPx: text.top,
    textSlideTextHeightPx: text.height
  };
}

function legacyTextBoundsFromSettings(settings = {}) {
  const canvas = canvasForResolution(settings.resolution);
  const scaleX = REFERENCE_CANVAS.width / canvas.width;
  const scaleY = REFERENCE_CANVAS.height / canvas.height;
  const readingMarginX = Number.isFinite(Number(settings.readingTextMarginXPx))
    ? Number(settings.readingTextMarginXPx)
    : 80;
  const readingTop = Number.isFinite(Number(settings.readingTextMarginYPx))
    ? Number(settings.readingTextMarginYPx)
    : 130;
  const readingHeight = Number.isFinite(Number(settings.readingTextHeightPx))
    ? Number(settings.readingTextHeightPx)
    : 840;
  const passageHeight = Math.ceil((Number(settings.readingPassageSizePx) || 44) * 2.3);
  const passageTop = Number.isFinite(Number(settings.readingPassageYPx))
    ? Number(settings.readingPassageYPx)
    : settings.readingPassagePosition === "bottom"
      ? 970
      : settings.readingPassagePosition === "middle"
        ? Math.max(0, Math.round((canvas.height - passageHeight) / 2))
        : 70;
  const passageWidth = Number.isFinite(Number(settings.readingPassageWidthPx))
    ? Number(settings.readingPassageWidthPx)
    : 650;
  const textMarginX = Number.isFinite(Number(settings.textSlideMarginXPx))
    ? Number(settings.textSlideMarginXPx)
    : 110;
  const textTop = Number.isFinite(Number(settings.textSlideMarginYPx))
    ? Number(settings.textSlideMarginYPx)
    : 90;
  const textHeight = Number.isFinite(Number(settings.textSlideTextHeightPx))
    ? Number(settings.textSlideTextHeightPx)
    : 900;

  const textBox = normalizeBounds({
    left: textMarginX * scaleX,
    right: textMarginX * scaleX,
    top: textTop * scaleY,
    bottom: (canvas.height - textTop - textHeight) * scaleY
  }, DEFAULT_TEXT_BOUNDS.text);

  return normalizeTextBounds({
    readingBody: {
      left: readingMarginX * scaleX,
      right: readingMarginX * scaleX,
      top: readingTop * scaleY,
      bottom: (canvas.height - readingTop - readingHeight) * scaleY
    },
    readingPassage: {
      left: readingMarginX * scaleX,
      right: (canvas.width - readingMarginX - passageWidth) * scaleX,
      top: passageTop * scaleY,
      bottom: (canvas.height - passageTop - passageHeight) * scaleY
    },
    hymn: textBox,
    prayer: textBox,
    text: textBox
  });
}

module.exports = {
  REFERENCE_CANVAS,
  MIN_BOX,
  RESOLUTION_CANVASES,
  DEFAULT_TEXT_BOUNDS,
  TEXT_BOUND_KEYS,
  normalizeBounds,
  normalizeTextBounds,
  normalizeGroupBounds,
  canvasForResolution,
  scaleBounds,
  boundsToRect,
  textBoundsToLegacySettings,
  legacyTextBoundsFromSettings
};
