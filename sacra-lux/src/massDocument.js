const VALID_KINDS = new Set(["text", "prayer", "hymn", "reading", "image", "countdown", "interstitial"]);
const VALID_SECTIONS = new Set(["pre", "gathering", "mass", "post"]);
const ITEM_KEYS = new Set(["id", "kind", "label", "section", "durationSec", "notes", "content", "source", "asset", "presentation"]);
const TOP_LEVEL_KEYS = new Set(["format", "version", "metadata", "presentationDefaults", "items", "assets"]);
const METADATA_KEYS = new Set(["title", "scheduledStart", "locale", "timezone", "rite"]);
const CONTENT_KEYS = new Set(["text", "seconds", "showLabel", "label"]);
const SOURCE_KEYS = new Set(["stem", "citation", "title", "translation", "attribution"]);
const ASSET_KEYS = new Set(["ref"]);
const PRESENTATION_KEYS = new Set(["background", "textAlign", "textVAlign", "fontFamily"]);
const VALID_DOCUMENT_BACKGROUNDS = new Set(["dark", "light"]);

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
  return (kind === "image" || kind === "interstitial") ? "light" : "dark";
}

function documentBackgroundToRuntime(value, kind) {
  const normalized = String(value || "");
  if (normalized === "light" || normalized === "image") return "light";
  if (normalized === "dark" || normalized === "color") return "dark";
  return (kind === "image" || kind === "interstitial") ? "light" : "dark";
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

  if (kind === "image") {
    if (content.text != null && typeof content.text !== "string") {
      throw new ValidationError("image item content.text must be a string.");
    }
    if (content.seconds != null) {
      throw new ValidationError("image items do not allow content.seconds.");
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
  if (["image", "interstitial", "countdown"].includes(kind)) {
    throw new ValidationError(`item.source is not allowed for kind "${kind}".`);
  }
}

function validateAssetForKind(kind, asset) {
  assertObject(asset, "item.asset");
  assertKnownKeys(asset, ASSET_KEYS, "item.asset");
  ensureNonEmptyString(asset.ref, "item.asset.ref");
  assetUrlFromRef(asset.ref);
  if (!["image", "interstitial"].includes(kind)) {
    throw new ValidationError(`item.asset is not allowed for kind "${kind}".`);
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

    if (["text", "prayer", "hymn", "reading", "countdown"].includes(kind) && item.asset != null) {
      throw new ValidationError(`item.asset is not allowed for kind "${kind}".`);
    }
    if (["text", "prayer", "hymn", "reading"].includes(kind) && item.content == null) {
      throw new ValidationError(`kind "${kind}" requires item.content.`);
    }
    if (kind === "countdown" && item.content == null) {
      throw new ValidationError("countdown items require item.content.");
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
    return item;
  }

  if (["text", "prayer", "hymn"].includes(organizerItem.type)) {
    item.content = { text: manualSlide?.text || "" };
    presentation.textVAlign = manualSlide?.textVAlign || "middle";
    item.presentation = presentation;
    return item;
  }

  if (organizerItem.type === "countdown") {
    item.content = {
      seconds: Math.max(1, Math.min(300, Number(manualSlide?.countdownSec) || 60)),
      showLabel: manualSlide?.countdownShowLabel !== false
    };
    if (manualSlide?.countdownFont) {
      presentation.fontFamily = manualSlide.countdownFont;
    }
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
    } else if (type === "countdown") {
      manual.text = "";
      manual.textVAlign = null;
      manual.imageUrl = null;
      manual.countdownSec = Number(item.content?.seconds) || 60;
      manual.countdownFont = item.presentation?.fontFamily || "";
      manual.countdownShowLabel = item.content?.showLabel !== false;
    } else {
      manual.text = item.content?.text || "";
      manual.textVAlign = null;
      manual.imageUrl = item.asset?.ref ? assetUrlFromRef(item.asset.ref) : null;
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
