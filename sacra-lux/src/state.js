const { DEFAULT_THEME } = require("./themes");

const state = {
  appSettings: {
    theme: DEFAULT_THEME
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
  screenSettings: {
    fontFamily: "Merriweather",
    fontSizePx: 60,
    colorBackgroundUrl: "/static/assets/background-dark.png",
    imageBackgroundUrl: "/static/assets/background-graphic.png",
    boldText: false,
    readingTextAlign: "left",
    readingPassagePosition: "top",
    readingPassageAlign: "center",
    readingPassageSizePx: 44,
    readingPassageOutline: false,
    readingPassageOutlineColor: "#000000",
    readingPassageOutlineWidthPx: 1,
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
    textSlideTextHeightPx: 900
  },
  currentSlideIndex: 0,
  isBlack: false,
  interstitialHoldActive: false,
  interstitialHoldSlideIndex: null,
  interstitialHoldReturnSlideIndex: null,
  interstitialHoldResumeState: null,
  massStartTime: null,
  startPinHash: null,
  startPin: "",
  targetScreenId: null,
  targetScreenIds: [],
  screenFullscreen: false,
  preMassRunning: false,
  gatheringRunning: false,
  postMassRunning: false,
  countdownEndsAt: null,
  activeMassArchiveId: null,
  lastUpdated: new Date().toISOString()
};

function getSafeSlideIndex(index) {
  const lastIndex = Math.max(0, state.presentation.slides.length - 1);
  return Math.min(Math.max(0, index), lastIndex);
}

function touch() {
  state.lastUpdated = new Date().toISOString();
}

function getStateSnapshot() {
  const snap = structuredClone(state);
  // Expose only whether a PIN is configured, not the PIN itself.
  snap.hasStartPin = Boolean(state.startPinHash?.hash || state.startPin);
  delete snap.startPin;
  delete snap.startPinHash;
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
