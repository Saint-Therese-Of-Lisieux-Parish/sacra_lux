function buildPdfSlideState(currentState, absoluteIndex) {
  return {
    ...currentState,
    currentSlideIndex: absoluteIndex,
    isBlack: false,
    countdownEndsAt: null,
    interstitialHoldActive: false,
    interstitialHoldSlideIndex: null,
    interstitialHoldReturnSlideIndex: null,
    interstitialHoldResumeState: null
  };
}

module.exports = { buildPdfSlideState };
