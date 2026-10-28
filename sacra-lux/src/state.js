const { DEFAULT_THEME } = require("./themes");
const { DEFAULT_TEXT_BOUNDS } = require("./textBounds");

const state = {
  appSettings: {
    theme: DEFAULT_THEME,
    remoteAddress: ""
  },
  presentation: {
    title: "No presentation loaded",
    sourceFile: null,
    slides: []
  },
  readingsSource: {
    folderPath: null,
    documents: []
  },
  organizerSequence: [],
  manualSlides: {},
  organizerRevision: 0,
  screenSettings: {
    fontFamily: "Merriweather",
    fontSizePx: 60,
    darkBackgroundUrl: "/static/assets/default-text-background.avif",
    lightBackgroundUrl: "/static/assets/default-interstitial.png",
    boldText: false,
    readingTextAlign: "left",
    readingPassagePosition: "top",
    readingPassageAlign: "center",
    readingPassageSizePx: 44,
    readingPassageOutline: false,
    readingPassageOutlineColor: "#000000",
    readingPassageOutlineWidthPx: 1,
    readingPassageItalic: false,
    readingPassageShadow: true,
    readingPassageLineHeight: 1.15,
    readingPassageLetterSpacingPx: 1.3,
    readingSectionFont: "Source Sans 3",
    readingSectionSizePx: 22,
    readingSectionColor: "#e8d5a0",
    readingSectionBold: true,
    readingSectionItalic: false,
    readingSectionShadow: true,
    readingSectionOutline: false,
    readingSectionOutlineColor: "#000000",
    readingSectionOutlineWidthPx: 1,
    readingTextMarginXPx: 80,
    readingTextMarginYPx: 130,
    readingTextHeightPx: 840,
    readingPassageYPx: 70,
    readingPassageWidthPx: 650,
    readingLineHeight: 1.58,
    readingLetterSpacingPx: 0,
    readingTextItalic: false,
    readingTextOutline: false,
    readingTextOutlineColor: "#000000",
    readingTextOutlineWidthPx: 1,
    readingTextShadow: true,
    readingShowEnding: true,
    textSlideTextAlign: "center",
    textSlideTextVAlign: "middle",
    textSlideTextFont: "",
    textSlideTextSizePx: 0,
    textSlideTextBold: false,
    textSlideTextItalic: false,
    textSlideTextColor: "#f8f8f8",
    textSlideLineHeight: 1.55,
    textSlideLetterSpacingPx: 0,
    textSlideTextOutline: false,
    textSlideTextOutlineColor: "#000000",
    textSlideTextOutlineWidthPx: 1,
    textSlideTextShadow: true,
    textSlideShowPageNumber: true,
    textSlideMarginXPx: 110,
    textSlideMarginYPx: 90,
    textSlideTextHeightPx: 900,
    textBounds: structuredClone(DEFAULT_TEXT_BOUNDS)
  },
  currentSlideIndex: 0,
  currentSlideId: null,
  currentSlideChangedAt: new Date().toISOString(),
  isBlack: false,
  interstitialHoldActive: false,
  interstitialHoldSlideIndex: null,
  interstitialHoldReturnSlideIndex: null,
  interstitialHoldResumeState: null,
  massStartTime: null,
  startPinHash: null,
  startPin: "",
  controlMode: "unset",
  targetScreenId: null,
  targetScreenIds: [],
  screenFullscreen: false,
  preMassRunning: false,
  gatheringRunning: false,
  postMassRunning: false,
  countdownEndsAt: null,
  imageSlideshowEndsAt: null,
  imageSlideshowLoopIteration: 1,
  imageSlideshowError: null,
  activeMassArchiveId: null,
  startupPrompt: null,
  saveError: "",
  lastUpdated: new Date().toISOString()
};

function getSafeSlideIndex(index) {
  const lastIndex = Math.max(0, state.presentation.slides.length - 1);
  return Math.min(Math.max(0, index), lastIndex);
}

function touch() {
  const now = new Date().toISOString();
  const currentSlideId = state.presentation?.slides?.[state.currentSlideIndex]?.id || null;
  if (currentSlideId !== state.currentSlideId) {
    state.currentSlideId = currentSlideId;
    state.currentSlideChangedAt = now;
  }
  state.lastUpdated = now;
}

function getStateSnapshot() {
  const snap = structuredClone(state);
  const parsedLastUpdated = Date.parse(state.lastUpdated);
  snap.serverTime = Number.isFinite(parsedLastUpdated) ? parsedLastUpdated : Date.now();
  // Expose only whether a PIN is configured, not the PIN itself.
  snap.hasStartPin = Boolean(state.startPinHash?.hash || state.startPin);
  snap.controlMode = state.controlMode === "trusted-lan" ? "trusted-lan" : "unset";
  delete snap.startPin;
  delete snap.startPinHash;
  // Expose only whether a Mass folder is loaded, not its absolute path.
  if (snap.readingsSource) {
    snap.readingsSource.hasFolder = Boolean(state.readingsSource?.folderPath);
    delete snap.readingsSource.folderPath;
  }
  delete snap.interstitialHoldReturnSlideIndex;
  delete snap.interstitialHoldResumeState;
  return snap;
}

module.exports = {
  state,
  getSafeSlideIndex,
  touch,
  getStateSnapshot
};
