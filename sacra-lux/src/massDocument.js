const VALID_KINDS = new Set(["text", "prayer", "hymn", "reading", "image", "imageSlideshow", "movie", "countdown", "interstitial"]);
const VALID_SECTIONS = new Set(["pre", "gathering", "mass", "post"]);
const ITEM_KEYS = new Set(["id", "kind", "label", "section", "durationSec", "notes", "content", "source", "asset", "assets", "presentation"]);
const TOP_LEVEL_KEYS = new Set(["format", "version", "metadata", "presentationDefaults", "items", "assets"]);
const METADATA_KEYS = new Set(["title", "scheduledStart", "locale", "timezone", "rite"]);
const CONTENT_KEYS = new Set(["text", "seconds", "showLabel", "label", "autoAdvance", "secondsPerImage", "loopCount"]);
const SOURCE_KEYS = new Set(["stem", "citation", "title", "translation", "attribution"]);
const ASSET_KEYS = new Set(["ref", "name"]);
const PRESENTATION_KEYS = new Set([
  "background",
  "textAlign",
  "textVAlign",
  "fontFamily",
  "fontSizePx",
  "bold",
  "italic",
  "outline",
  "shadow",
  "countdownStyle",
  "countdownSizePercent",
  "loop",
  "psalmRefrainIndex"
]);
const VALID_DOCUMENT_BACKGROUNDS = new Set(["dark", "light"]);
const VALID_COUNTDOWN_STYLES = new Set(["ring", "digits", "bar", "minimal", "hourglass", "stopwatch"]);

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
}

function assertKnownKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value || {})) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(`${label} contains unknown key "${key}".`);
    }
  }
}

function normalizeSection(value) {
  if (value === "warmup") return "gathering";
  const normalized = String(value || "");
  if (!VALID_SECTIONS.has(normalized)) {
    throw new ValidationError(`Unsupported section "${normalized || value}".`);
  }
  return normalized;
}

function normalizeKind(value) {
  const normalized = String(value || "");
  if (!VALID_KINDS.has(normalized)) {
    throw new ValidationError(`Unsupported kind "${normalized || value}".`);
  }
  return normalized;
}

function ensureNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeDuration(value) {
  if (value == null) return null;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
    throw new ValidationError("durationSec must be an integer between 1 and 3600.");
  }
  return duration;
}

function runtimeBackgroundToDocument(value, kind) {
  const normalized = String(value || "");
  if (normalized === "image") return "light";
  if (normalized === "color") return "dark";
  if (normalized === "light") return "light";
  if (normalized === "dark") return "dark";
  return (kind === "image" || kind === "imageSlideshow" || kind === "interstitial" || kind === "movie") ? "light" : "dark";
}

function documentBackgroundToRuntime(value, kind) {
  const normalized = String(value || "");
  if (normalized === "light" || normalized === "image") return "light";
  if (normalized === "dark" || normalized === "color") return "dark";
  return (kind === "image" || kind === "imageSlideshow" || kind === "interstitial" || kind === "movie") ? "light" : "dark";
}

function sanitizeStem(value, fallbackId) {
  const raw = String(value || fallbackId || "reading");
  const stem = raw
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return stem || "reading";
}

function buildAssetRef(filename) {
  return filename ? `assets/${filename}` : null;
}

function assetRefFromUrl(url) {
  const apiMatch = String(url || "").match(/\/api\/mass-asset\/([^/]+)$/);
  if (apiMatch) return buildAssetRef(apiMatch[1]);

  const legacyUploadMatch = String(url || "").match(/\/static\/uploads\/([^/]+)$/);
  if (legacyUploadMatch) return buildAssetRef(legacyUploadMatch[1]);

  return null;
}

function assetUrlFromRef(ref) {
  const normalized = String(ref || "");
  const match = normalized.match(/^assets\/([^/]+)$/);
  if (!match) {
    throw new ValidationError(`Unsupported asset ref "${normalized}".`);
  }
  return `/api/mass-asset/${match[1]}`;
}

function buildAssetsManifest(document) {
  const refs = new Set();
  for (const item of document.items || []) {
    if (item.asset?.ref) refs.add(item.asset.ref);
    for (const asset of item.assets || []) {
      if (asset?.ref) refs.add(asset.ref);
    }
  }
  if (document.presentationDefaults?.darkBackgroundUrl) {
    if (String(document.presentationDefaults.darkBackgroundUrl).startsWith("assets/")) {
      refs.add(document.presentationDefaults.darkBackgroundUrl);
    }
  }
  if (document.presentationDefaults?.lightBackgroundUrl) {
    if (String(document.presentationDefaults.lightBackgroundUrl).startsWith("assets/")) {
      refs.add(document.presentationDefaults.lightBackgroundUrl);
    }
  }

  const assets = {};
  for (const ref of refs) {
    assets[ref] = {};
  }
  return assets;
}

function validateContentForKind(kind, content) {
  assertObject(content, "item.content");
  assertKnownKeys(content, CONTENT_KEYS, "item.content");

  if (["text", "prayer", "hymn", "reading"].includes(kind)) {
    if (typeof content.text !== "string") {
      throw new ValidationError("item.content.text must be a string.");
    }
    if (content.seconds != null) {
      throw new ValidationError(`item.content.seconds is not allowed for kind "${kind}".`);
    }
    return;
  }

  if (kind === "countdown") {
    const seconds = Number(content.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
      throw new ValidationError("countdown items require content.seconds between 1 and 300.");
    }
    if (content.text != null) {
      throw new ValidationError("countdown items do not allow content.text.");
    }
    return;
  }

  if (kind === "image" || kind === "movie") {
    if (content.text != null && typeof content.text !== "string") {
      throw new ValidationError(`${kind} item content.text must be a string.`);
    }
    if (content.seconds != null) {
      throw new ValidationError(`${kind} items do not allow content.seconds.`);
    }
    if (content.autoAdvance != null && typeof content.autoAdvance !== "boolean") {
      throw new ValidationError(`${kind} item content.autoAdvance must be a boolean.`);
    }
    return;
  }

  if (kind === "imageSlideshow") {
    const secondsPerImage = Number(content.secondsPerImage);
    if (!Number.isInteger(secondsPerImage) || secondsPerImage < 1 || secondsPerImage > 3600) {
      throw new ValidationError("imageSlideshow items require content.secondsPerImage between 1 and 3600.");
    }
    const loopCount = Number(content.loopCount);
    if (!Number.isInteger(loopCount) || loopCount < 1 || loopCount > 1000) {
      throw new ValidationError("imageSlideshow items require content.loopCount between 1 and 1000.");
    }
    if (content.text != null || content.seconds != null || content.autoAdvance != null) {
      throw new ValidationError("imageSlideshow content only supports secondsPerImage and loopCount.");
    }
    return;
  }

  if (kind === "interstitial") {
    if (content.text != null && typeof content.text !== "string") {
      throw new ValidationError("interstitial item content.text must be a string.");
    }
    if (content.seconds != null) {
      throw new ValidationError("interstitial items do not allow content.seconds.");
    }
  }
}

function validateSourceForKind(kind, source) {
  assertObject(source, "item.source");
  assertKnownKeys(source, SOURCE_KEYS, "item.source");
  if (["image", "imageSlideshow", "movie", "interstitial", "countdown"].includes(kind)) {
    throw new ValidationError(`item.source is not allowed for kind "${kind}".`);
  }
}

function validateAssetForKind(kind, asset) {
  assertObject(asset, "item.asset");
  assertKnownKeys(asset, ASSET_KEYS, "item.asset");
  ensureNonEmptyString(asset.ref, "item.asset.ref");
  assetUrlFromRef(asset.ref);
  if (!["image", "movie", "interstitial"].includes(kind)) {
    throw new ValidationError(`item.asset is not allowed for kind "${kind}".`);
  }
}

function validateAssetsForKind(kind, assets) {
  if (kind !== "imageSlideshow") {
    throw new ValidationError(`item.assets is not allowed for kind "${kind}".`);
  }
  if (!Array.isArray(assets)) {
    throw new ValidationError("imageSlideshow item.assets must be an array.");
  }
  if (assets.length > 500) {
    throw new ValidationError("imageSlideshow item.assets cannot contain more than 500 images.");
  }
  for (const asset of assets) {
    assertObject(asset, "item.assets entry");
    assertKnownKeys(asset, ASSET_KEYS, "item.assets entry");
    ensureNonEmptyString(asset.ref, "item.assets entry ref");
    assetUrlFromRef(asset.ref);
    if (asset.name != null && typeof asset.name !== "string") {
      throw new ValidationError("item.assets entry name must be a string.");
    }
  }
}

function validatePresentation(presentation) {
  assertObject(presentation, "item.presentation");
  assertKnownKeys(presentation, PRESENTATION_KEYS, "item.presentation");

  if (presentation.background != null && !VALID_DOCUMENT_BACKGROUNDS.has(String(presentation.background))) {
    throw new ValidationError(`Unsupported presentation.background "${presentation.background}".`);
  }
  if (presentation.textAlign != null && !["left", "center", "right"].includes(String(presentation.textAlign))) {
    throw new ValidationError(`Unsupported presentation.textAlign "${presentation.textAlign}".`);
  }
  if (presentation.textVAlign != null && !["top", "middle", "bottom"].includes(String(presentation.textVAlign))) {
    throw new ValidationError(`Unsupported presentation.textVAlign "${presentation.textVAlign}".`);
  }
  if (presentation.fontFamily != null && typeof presentation.fontFamily !== "string") {
    throw new ValidationError("presentation.fontFamily must be a string.");
  }
  if (presentation.fontSizePx != null) {
    const fontSizePx = Number(presentation.fontSizePx);
    if (!Number.isFinite(fontSizePx) || fontSizePx < 24 || fontSizePx > 200) {
      throw new ValidationError("presentation.fontSizePx must be between 24 and 200.");
    }
  }
  for (const key of ["bold", "italic", "outline", "shadow"]) {
    if (presentation[key] != null && typeof presentation[key] !== "boolean") {
      throw new ValidationError(`presentation.${key} must be a boolean.`);
    }
  }
  if (presentation.countdownStyle != null && !VALID_COUNTDOWN_STYLES.has(String(presentation.countdownStyle))) {
    throw new ValidationError(`Unsupported presentation.countdownStyle "${presentation.countdownStyle}".`);
  }
  if (presentation.countdownSizePercent != null) {
    const size = Number(presentation.countdownSizePercent);
    if (!Number.isFinite(size) || size < 50 || size > 200) {
      throw new ValidationError("presentation.countdownSizePercent must be between 50 and 200.");
    }
  }
  if (presentation.loop != null && typeof presentation.loop !== "boolean") {
    throw new ValidationError("presentation.loop must be a boolean.");
  }
  if (presentation.psalmRefrainIndex != null) {
    const refrainIndex = Number(presentation.psalmRefrainIndex);
    if (!Number.isInteger(refrainIndex) || refrainIndex < 0) {
      throw new ValidationError("presentation.psalmRefrainIndex must be a non-negative integer.");
    }
  }
}

function validateMassDocument(document) {
  assertObject(document, "Mass document");
  assertKnownKeys(document, TOP_LEVEL_KEYS, "Mass document");

  if (document.format !== "sacra-lux.mass") {
    throw new ValidationError("Mass document format must be \"sacra-lux.mass\".");
  }
  if (document.version !== 3) {
    throw new ValidationError("Mass document version must be 3.");
  }

  assertObject(document.metadata || {}, "metadata");
  assertKnownKeys(document.metadata || {}, METADATA_KEYS, "metadata");
  ensureNonEmptyString(document.metadata?.title, "metadata.title");
  if (document.metadata?.scheduledStart != null) {
    const scheduledStart = ensureNonEmptyString(document.metadata.scheduledStart, "metadata.scheduledStart");
    if (Number.isNaN(new Date(scheduledStart).getTime())) {
      throw new ValidationError("metadata.scheduledStart must be a valid datetime string.");
    }
  }

  if (document.presentationDefaults != null) {
    assertObject(document.presentationDefaults, "presentationDefaults");
  }
  if (document.assets != null) {
    assertObject(document.assets, "assets");
  }
  if (!Array.isArray(document.items)) {
    throw new ValidationError("items must be an array.");
  }

  const seenIds = new Set();
  for (const item of document.items) {
    assertObject(item, "item");
    assertKnownKeys(item, ITEM_KEYS, "item");
    const id = ensureNonEmptyString(item.id, "item.id");
    if (seenIds.has(id)) {
      throw new ValidationError(`Duplicate item id "${id}".`);
    }
    seenIds.add(id);

    const kind = normalizeKind(item.kind);
    normalizeSection(item.section);
    ensureNonEmptyString(item.label, "item.label");
    normalizeDuration(item.durationSec);

    if (item.notes != null && typeof item.notes !== "string") {
      throw new ValidationError("item.notes must be a string.");
    }
    if (item.presentation != null) {
      validatePresentation(item.presentation);
    }

    if (item.content != null) {
      validateContentForKind(kind, item.content);
    }
    if (item.source != null) {
      validateSourceForKind(kind, item.source);
    }
    if (item.asset != null) {
      validateAssetForKind(kind, item.asset);
    }
    if (item.assets != null) {
      validateAssetsForKind(kind, item.assets);
    }

    if (["text", "prayer", "hymn", "reading", "countdown"].includes(kind) && item.asset != null) {
      throw new ValidationError(`item.asset is not allowed for kind "${kind}".`);
    }
    if (["text", "prayer", "hymn", "reading"].includes(kind) && item.content == null) {
      throw new ValidationError(`kind "${kind}" requires item.content.`);
    }
    if (kind === "countdown" && item.content == null) {
      throw new ValidationError("countdown items require item.content.");
    }
    if (kind === "imageSlideshow" && item.content == null) {
      throw new ValidationError("imageSlideshow items require item.content.");
    }
    if (kind === "imageSlideshow" && item.asset != null) {
      throw new ValidationError("imageSlideshow items use item.assets instead of item.asset.");
    }
    if (kind !== "imageSlideshow" && item.assets != null) {
      throw new ValidationError(`item.assets is not allowed for kind "${kind}".`);
    }
  }

  return document;
}

function remapScreenSettingsForDocument(screenSettings = {}) {
  const presentationDefaults = { ...screenSettings };
  if (presentationDefaults.colorBackgroundUrl && !presentationDefaults.darkBackgroundUrl) {
    presentationDefaults.darkBackgroundUrl = presentationDefaults.colorBackgroundUrl;
    delete presentationDefaults.colorBackgroundUrl;
  }
  if (presentationDefaults.imageBackgroundUrl && !presentationDefaults.lightBackgroundUrl) {
    presentationDefaults.lightBackgroundUrl = presentationDefaults.imageBackgroundUrl;
    delete presentationDefaults.imageBackgroundUrl;
  }
  if (presentationDefaults.darkBackgroundUrl) {
    presentationDefaults.darkBackgroundUrl = assetRefFromUrl(presentationDefaults.darkBackgroundUrl) || presentationDefaults.darkBackgroundUrl;
  }
  if (presentationDefaults.lightBackgroundUrl) {
    presentationDefaults.lightBackgroundUrl = assetRefFromUrl(presentationDefaults.lightBackgroundUrl) || presentationDefaults.lightBackgroundUrl;
  }
  return presentationDefaults;
}

function remapPresentationDefaultsToScreenSettings(presentationDefaults = {}) {
  const screenSettings = { ...presentationDefaults };
  if (screenSettings.colorBackgroundUrl && !screenSettings.darkBackgroundUrl) {
    screenSettings.darkBackgroundUrl = screenSettings.colorBackgroundUrl;
    delete screenSettings.colorBackgroundUrl;
  }
  if (screenSettings.imageBackgroundUrl && !screenSettings.lightBackgroundUrl) {
    screenSettings.lightBackgroundUrl = screenSettings.imageBackgroundUrl;
    delete screenSettings.imageBackgroundUrl;
  }
  for (const key of ["darkBackgroundUrl", "lightBackgroundUrl"]) {
    if (screenSettings[key] && String(screenSettings[key]).startsWith("assets/")) {
      screenSettings[key] = assetUrlFromRef(screenSettings[key]);
    }
  }
  return screenSettings;
}

function serializeStyleOverrides(styleOverrides) {
  if (!styleOverrides || typeof styleOverrides !== "object" || Array.isArray(styleOverrides)) {
    return {};
  }

  const presentation = {};
  const fontFamily = typeof styleOverrides.fontFamily === "string" ? styleOverrides.fontFamily.trim() : "";
  if (fontFamily) {
    presentation.fontFamily = fontFamily;
  }

  const fontSizePx = Number(styleOverrides.fontSizePx);
  if (Number.isFinite(fontSizePx) && fontSizePx >= 24 && fontSizePx <= 200) {
    presentation.fontSizePx = Math.round(fontSizePx);
  }

  for (const key of ["bold", "italic", "outline", "shadow"]) {
    if (typeof styleOverrides[key] === "boolean") {
      presentation[key] = styleOverrides[key];
    }
  }

  return presentation;
}

function readStyleOverridesFromPresentation(presentation = {}) {
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) {
    return {};
  }

  const styleOverrides = {};
  const fontFamily = typeof presentation.fontFamily === "string" ? presentation.fontFamily.trim() : "";
  if (fontFamily) {
    styleOverrides.fontFamily = fontFamily;
  }

  const fontSizePx = Number(presentation.fontSizePx);
  if (Number.isFinite(fontSizePx) && fontSizePx >= 24 && fontSizePx <= 200) {
    styleOverrides.fontSizePx = Math.round(fontSizePx);
  }

  for (const key of ["bold", "italic", "outline", "shadow"]) {
    if (typeof presentation[key] === "boolean") {
      styleOverrides[key] = presentation[key];
    }
  }

  return styleOverrides;
}

function buildItemFromState(organizerItem, manualSlide, documentsByStem) {
  const item = {
    id: String(organizerItem.id),
    kind: String(organizerItem.type),
    label: String(organizerItem.label || "Slide"),
    section: String(organizerItem.phase || "mass"),
    durationSec: Number(organizerItem.durationSec) || 10
  };

  const presentation = {
    background: runtimeBackgroundToDocument(organizerItem.backgroundTheme, organizerItem.type)
  };
  const notes = manualSlide?.notes || "";
  if (notes) item.notes = notes;

  if (organizerItem.type === "reading") {
    const doc = documentsByStem.get(organizerItem.sourceStem) || null;
    item.content = {
      text: doc ? doc.textLines.join("\n") : ""
    };
    item.source = {
      stem: sanitizeStem(organizerItem.sourceStem, organizerItem.id)
    };
    if (doc?.passage) item.source.citation = doc.passage;
    const readingPresentation = {
      ...presentation,
      ...serializeStyleOverrides(organizerItem.styleOverrides)
    };
    if (Number(organizerItem.psalmRefrainIndex) > 0) {
      readingPresentation.psalmRefrainIndex = Math.floor(Number(organizerItem.psalmRefrainIndex));
    }
    item.presentation = readingPresentation;
    return item;
  }

  if (["text", "prayer", "hymn"].includes(organizerItem.type)) {
    item.content = { text: manualSlide?.text || "" };
    presentation.textVAlign = manualSlide?.textVAlign || "middle";
    Object.assign(presentation, serializeStyleOverrides(manualSlide?.styleOverrides));
    item.presentation = presentation;
    return item;
  }

  if (organizerItem.type === "countdown") {
    item.content = {
      seconds: Math.max(1, Math.min(300, Number(manualSlide?.countdownSec) || 60)),
      showLabel: false
    };
    if (manualSlide?.countdownFont) {
      presentation.fontFamily = manualSlide.countdownFont;
    }
    if (manualSlide?.countdownStyle) {
      presentation.countdownStyle = VALID_COUNTDOWN_STYLES.has(String(manualSlide.countdownStyle))
        ? String(manualSlide.countdownStyle)
        : "ring";
    }
    presentation.countdownSizePercent = Math.max(50, Math.min(200, Number(manualSlide?.countdownSizePercent) || 100));
    item.presentation = presentation;
    return item;
  }

  if (organizerItem.type === "movie") {
    if (manualSlide?.text) {
      item.content = { text: manualSlide.text };
    }
    if (manualSlide?.videoAutoAdvance === false) {
      item.content = {
        ...(item.content || {}),
        autoAdvance: false
      };
    }
    const assetRef = assetRefFromUrl(manualSlide?.videoUrl || null);
    if (assetRef) {
      item.asset = { ref: assetRef };
    }
    presentation.loop = Boolean(manualSlide?.videoLoop);
    item.presentation = presentation;
    return item;
  }

  if (organizerItem.type === "imageSlideshow") {
    item.content = {
      secondsPerImage: Math.max(1, Math.min(3600, Math.round(Number(manualSlide?.slideshowDurationSec) || 10))),
      loopCount: Math.max(1, Math.min(1000, Math.round(Number(manualSlide?.slideshowLoopCount) || 1)))
    };
    item.assets = (Array.isArray(manualSlide?.images) ? manualSlide.images : [])
      .map((entry) => {
        const url = typeof entry === "string" ? entry : entry?.url;
        const ref = assetRefFromUrl(url);
        if (!ref) return null;
        const name = typeof entry?.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : ref.split("/").pop();
        return { ref, name };
      })
      .filter(Boolean);
    item.presentation = presentation;
    return item;
  }

  if (manualSlide?.text) {
    item.content = { text: manualSlide.text };
  }
  const assetRef = assetRefFromUrl(manualSlide?.imageUrl || null);
  if (assetRef) {
    item.asset = { ref: assetRef };
  }
  item.presentation = presentation;
  return item;
}

function buildMassDocumentFromState(state) {
  const documentsByStem = new Map((state.readingsSource?.documents || []).map((doc) => [doc.stem, doc]));
  const document = {
    format: "sacra-lux.mass",
    version: 3,
    metadata: {
      title: state.presentation?.title || "Mass Presentation",
      scheduledStart: state.massStartTime || null
    },
    presentationDefaults: remapScreenSettingsForDocument(state.screenSettings || {}),
    items: state.organizerSequence.map((item) => buildItemFromState(item, state.manualSlides?.[item.id], documentsByStem))
  };
  document.assets = buildAssetsManifest(document);
  return document;
}

function buildReadingDocumentFromItem(item) {
  const stem = sanitizeStem(item.source?.stem, item.id);
  return {
    stem,
    section: item.label,
    passage: item.source?.citation || item.label,
    textLines: String(item.content?.text || "").split("\n"),
    ending: null
  };
}

function buildRuntimeStateFromMassDocument(document) {
  validateMassDocument(document);

  const organizerSequence = [];
  const manualSlides = {};
  const documents = [];

  for (const item of document.items) {
    const type = item.kind;
    const backgroundTheme = documentBackgroundToRuntime(item.presentation?.background, type);
    const organizerItem = {
      id: item.id,
      type,
      label: item.label,
      phase: item.section,
      backgroundTheme,
      durationSec: item.durationSec != null ? item.durationSec : 10
    };

    if (type === "reading") {
      const doc = buildReadingDocumentFromItem(item);
      organizerItem.sourceStem = doc.stem;
      if (Number(item.presentation?.psalmRefrainIndex) > 0) {
        organizerItem.psalmRefrainIndex = Math.floor(Number(item.presentation.psalmRefrainIndex));
      }
      organizerItem.styleOverrides = readStyleOverridesFromPresentation(item.presentation);
      documents.push(doc);
      organizerSequence.push(organizerItem);
      continue;
    }

    organizerSequence.push(organizerItem);
    const manual = {
      notes: item.notes || ""
    };

    if (["text", "prayer", "hymn"].includes(type)) {
      manual.text = item.content?.text || "";
      manual.textVAlign = item.presentation?.textVAlign || "middle";
      manual.imageUrl = null;
      manual.styleOverrides = readStyleOverridesFromPresentation(item.presentation);
    } else if (type === "countdown") {
      manual.text = "";
      manual.textVAlign = null;
      manual.imageUrl = null;
      manual.countdownSec = Number(item.content?.seconds) || 60;
      manual.countdownFont = item.presentation?.fontFamily || "";
      manual.countdownStyle = VALID_COUNTDOWN_STYLES.has(String(item.presentation?.countdownStyle))
        ? String(item.presentation.countdownStyle)
        : "ring";
      manual.countdownSizePercent = Math.max(50, Math.min(200, Number(item.presentation?.countdownSizePercent) || 100));
      manual.styleOverrides = {};
    } else if (type === "movie") {
      manual.text = item.content?.text || "";
      manual.textVAlign = null;
      manual.imageUrl = null;
      manual.videoUrl = item.asset?.ref ? assetUrlFromRef(item.asset.ref) : null;
      manual.videoLoop = Boolean(item.presentation?.loop);
      manual.videoAutoAdvance = item.content?.autoAdvance !== false;
      manual.styleOverrides = {};
    } else if (type === "imageSlideshow") {
      manual.text = "";
      manual.textVAlign = null;
      manual.imageUrl = null;
      manual.images = (item.assets || []).map((asset) => ({
        url: assetUrlFromRef(asset.ref),
        name: typeof asset.name === "string" && asset.name.trim()
          ? asset.name.trim()
          : asset.ref.split("/").pop()
      }));
      manual.slideshowDurationSec = Math.max(1, Math.min(3600, Number(item.content?.secondsPerImage) || 10));
      manual.slideshowLoopCount = Math.max(1, Math.min(1000, Number(item.content?.loopCount) || 1));
      manual.styleOverrides = {};
    } else {
      manual.text = item.content?.text || "";
      manual.textVAlign = null;
      manual.imageUrl = item.asset?.ref ? assetUrlFromRef(item.asset.ref) : null;
      manual.styleOverrides = {};
    }

    manualSlides[item.id] = manual;
  }

  return {
    presentationTitle: document.metadata.title,
    massStartTime: document.metadata.scheduledStart || null,
    screenSettings: remapPresentationDefaultsToScreenSettings(document.presentationDefaults || {}),
    organizerSequence,
    manualSlides,
    documents
  };
}

function isMassDocumentV3(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.format === "sacra-lux.mass" &&
    value.version === 3;
}

function buildMassDocumentFromLegacyPackage(packageData, documents = [], screenSettings = {}) {
  const workingState = {
    presentation: {
      title: packageData.presentationTitle || "Mass Presentation"
    },
    massStartTime: packageData.massStartTime || null,
    screenSettings,
    organizerSequence: packageData.organizerSequence || [],
    manualSlides: packageData.manualSlides || packageData.manualCues || {},
    readingsSource: {
      documents
    }
  };
  return buildMassDocumentFromState(workingState);
}

function serializeReadingDocument(doc) {
  const lines = [doc.passage || doc.section || doc.stem, "", ...(doc.textLines || [])];
  return `${lines.join("\n").replace(/\s+$/u, "")}\n`;
}

module.exports = {
  ValidationError,
  assetRefFromUrl,
  assetUrlFromRef,
  buildMassDocumentFromLegacyPackage,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  isMassDocumentV3,
  serializeReadingDocument,
  validateMassDocument
};
