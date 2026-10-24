const {
  DEFAULT_TEXT_BOUNDS,
  boundsToRect,
  legacyTextBoundsFromSettings,
  normalizeGroupBounds,
  normalizeTextBounds
} = require("../../src/textBounds");

describe("text bounds", () => {
  test("keeps independent valid bounds for each supported layout", () => {
    const input = {
      readingBody: { left: 10, right: 20, top: 30, bottom: 40 },
      readingPassage: { left: 50, right: 60, top: 70, bottom: 80 },
      hymn: { left: 90, right: 100, top: 110, bottom: 120 },
      prayer: { left: 130, right: 140, top: 150, bottom: 160 },
      text: { left: 170, right: 180, top: 190, bottom: 200 }
    };

    expect(normalizeTextBounds(input)).toEqual(input);
  });

  test("corrects nonnumeric, negative, collapsed, and oversized values", () => {
    const normalized = normalizeTextBounds({
      readingBody: { left: -20, right: 5000, top: "bad", bottom: 5000 }
    });
    const bounds = normalized.readingBody;

    expect(bounds.left).toBe(0);
    expect(bounds.top).toBe(DEFAULT_TEXT_BOUNDS.readingBody.top);
    expect(1920 - bounds.left - bounds.right).toBeGreaterThanOrEqual(120);
    expect(1080 - bounds.top - bounds.bottom).toBeGreaterThanOrEqual(80);
  });

  test.each(["720p", "1080p", "1440p", "4k"])(
    "keeps the same relative rectangle at %s",
    (resolution) => {
      const rect = boundsToRect({ left: 192, right: 384, top: 108, bottom: 216 }, resolution);
      const widths = { "720p": 1280, "1080p": 1920, "1440p": 2560, "4k": 3840 };
      const heights = { "720p": 720, "1080p": 1080, "1440p": 1440, "4k": 2160 };
      expect(rect.left / widths[resolution]).toBeCloseTo(0.1, 6);
      expect(rect.top / heights[resolution]).toBeCloseTo(0.1, 6);
      expect(rect.width / widths[resolution]).toBeCloseTo(0.7, 6);
      expect(rect.height / heights[resolution]).toBeCloseTo(0.7, 6);
    }
  );

  test("maps legacy 1080p fields to the prior layout", () => {
    expect(legacyTextBoundsFromSettings({
      resolution: "1080p",
      readingTextMarginXPx: 80,
      readingTextMarginYPx: 130,
      readingTextHeightPx: 840,
      readingPassageYPx: 70,
      readingPassageWidthPx: 650,
      readingPassageSizePx: 44,
      textSlideMarginXPx: 110,
      textSlideMarginYPx: 90,
      textSlideTextHeightPx: 900
    })).toEqual(DEFAULT_TEXT_BOUNDS);
  });

  test("normalizes independent group body and passage overrides", () => {
    expect(normalizeGroupBounds({
      body: { left: 100, right: 200, top: 120, bottom: 140 },
      passage: { left: 300, right: 400, top: 40, bottom: 900 }
    })).toEqual({
      body: { left: 100, right: 200, top: 120, bottom: 140 },
      passage: { left: 300, right: 400, top: 40, bottom: 900 }
    });
  });
});
