describe("state", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("clamps slide indexes to the available range", () => {
    const { state, getSafeSlideIndex } = require("../../src/state");

    state.presentation.slides = [{}, {}, {}];

    expect(getSafeSlideIndex(-10)).toBe(0);
    expect(getSafeSlideIndex(1)).toBe(1);
    expect(getSafeSlideIndex(10)).toBe(2);
  });

  test("touch refreshes the lastUpdated timestamp", () => {
    const { state, touch } = require("../../src/state");

    state.lastUpdated = "2000-01-01T00:00:00.000Z";
    touch();

    expect(state.lastUpdated).not.toBe("2000-01-01T00:00:00.000Z");
    expect(Number.isNaN(Date.parse(state.lastUpdated))).toBe(false);
  });

  test("getStateSnapshot hides secrets and internal interstitial fields", () => {
    const { state, getStateSnapshot } = require("../../src/state");

    state.startPin = "1234";
    state.startPinHash = { hash: "abc", salt: "def", iterations: 10 };
    state.interstitialHoldReturnSlideIndex = 8;
    state.interstitialHoldResumeState = { wasBlack: true };

    const snapshot = getStateSnapshot();

    expect(snapshot.hasStartPin).toBe(true);
    expect(snapshot.startPin).toBeUndefined();
    expect(snapshot.startPinHash).toBeUndefined();
    expect(snapshot.interstitialHoldReturnSlideIndex).toBeUndefined();
    expect(snapshot.interstitialHoldResumeState).toBeUndefined();
  });
});
