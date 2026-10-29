const { buildPdfSlideState } = require("../../src/pdfCaptureState");

describe("buildPdfSlideState", () => {
  test("renders the requested slide without live interstitial state", () => {
    const state = buildPdfSlideState({
      currentSlideIndex: 4,
      interstitialHoldActive: true,
      interstitialHoldSlideIndex: 2,
      interstitialHoldReturnSlideIndex: 4,
      interstitialHoldResumeState: { isBlack: false },
      isBlack: true,
      countdownEndsAt: 123
    }, 1);

    expect(state).toMatchObject({
      currentSlideIndex: 1,
      interstitialHoldActive: false,
      interstitialHoldSlideIndex: null,
      interstitialHoldReturnSlideIndex: null,
      interstitialHoldResumeState: null,
      isBlack: false,
      countdownEndsAt: null
    });
  });
});
