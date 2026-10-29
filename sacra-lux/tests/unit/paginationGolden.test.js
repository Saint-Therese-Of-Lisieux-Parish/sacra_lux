const { paginateDocuments, clearPaginationCache } = require("../../src/readingsImporter");

// Canvas widths from RESOLUTION_CANVAS_WIDTHS in src/organizer.js.
const CANVAS_WIDTHS = { "720p": 1280, "1080p": 1920, "1440p": 2560, "4k": 3840 };
const DEFAULT_READING_HEIGHTS = { "720p": 560, "1080p": 840, "1440p": 1120, "4k": 1680 };
const FONT_SIZES = [48, 60, 80];
const BOX_HEIGHT_PX = 840;
const MARGIN_X_PX = 80;
const LINE_HEIGHT = 1.58;
const CHAR_WIDTH_RATIO = 0.55;

const verse = (n) =>
  `Verse ${n}: the word of the Lord came to the prophet in the days of the king, and he spoke to the people gathered at the gate of the city.`;
const verses = Array.from({ length: 24 }, (_, index) => verse(index + 1));

const READING = {
  stem: "Reading_I",
  section: "Reading I",
  passage: "Isaiah 1:1-24",
  textLines: verses,
  ending: null
};

const PSALM = {
  stem: "Responsorial_Psalm",
  section: "Responsorial Psalm",
  passage: "Psalm 23",
  textLines: [
    "R. The Lord is my shepherd.",
    ...verses.slice(0, 6),
    "R. The Lord is my shepherd.",
    ...verses.slice(6, 10),
    "R. The Lord is my shepherd."
  ],
  ending: null
};

// Golden page counts for the fixed text above. A change here means a reading
// splits into a different number of slides, so check it on purpose.
// Keys are "resolution/fontSizePx".
const GOLDEN_PAGE_COUNTS = {
  reading: {
    "720p/48": 12, "720p/60": 24, "720p/80": 24,
    "1080p/48": 8, "1080p/60": 12, "1080p/80": 24,
    "1440p/48": 5, "1440p/60": 6, "1440p/80": 12,
    "4k/48": 3, "4k/60": 6, "4k/80": 8
  },
  psalm: {
    "720p/48": 8, "720p/60": 13, "720p/80": 13,
    "1080p/48": 7, "1080p/60": 8, "1080p/80": 13,
    "1440p/48": 6, "1440p/60": 6, "1440p/80": 8,
    "4k/48": 5, "4k/60": 6, "4k/80": 7
  }
};

function paginate(doc, resolution, fontSizePx) {
  return paginateDocuments([doc], {
    fontSizePx,
    readingTextHeightPx: BOX_HEIGHT_PX,
    readingTextMarginXPx: MARGIN_X_PX,
    canvasWidth: CANVAS_WIDTHS[resolution]
  });
}

// Count the wrapped lines on a page without the importer's own estimator.
function visualLines(pageText, resolution, fontSizePx) {
  const boxWidthPx = CANVAS_WIDTHS[resolution] - (MARGIN_X_PX * 2);
  const charsPerLine = Math.max(1, Math.floor(boxWidthPx / (fontSizePx * CHAR_WIDTH_RATIO)));
  return pageText.split("\n").reduce(
    (total, line) => total + (line.trim() === "" ? 1 : Math.max(1, Math.ceil(line.length / charsPerLine))),
    0
  );
}

function maxLinesPerPage(fontSizePx) {
  return Math.max(1, Math.floor(BOX_HEIGHT_PX / (fontSizePx * LINE_HEIGHT)));
}

describe("reading pagination golden tests", () => {
  beforeEach(() => {
    clearPaginationCache();
  });

  for (const [name, doc] of [["reading", READING], ["psalm", PSALM]]) {
    for (const resolution of Object.keys(CANVAS_WIDTHS)) {
      for (const fontSizePx of FONT_SIZES) {
        const key = `${resolution}/${fontSizePx}`;

        test(`${name} at ${key} keeps its page count`, () => {
          expect(paginate(doc, resolution, fontSizePx)).toHaveLength(GOLDEN_PAGE_COUNTS[name][key]);
        });

        test(`${name} at ${key} has no page that overflows the text box`, () => {
          const limit = maxLinesPerPage(fontSizePx);
          for (const slide of paginate(doc, resolution, fontSizePx)) {
            expect(visualLines(slide.text, resolution, fontSizePx)).toBeLessThanOrEqual(limit);
          }
        });
      }
    }
  }

  test("a reading keeps every source line in order across all pages", () => {
    for (const resolution of Object.keys(CANVAS_WIDTHS)) {
      const text = paginate(READING, resolution, 60).map((slide) => slide.text).join("\n");
      expect(text.split("\n").filter(Boolean)).toEqual(verses);
    }
  });

  test("a wider canvas never needs more pages for the same text and font", () => {
    for (const fontSizePx of FONT_SIZES) {
      const counts = Object.keys(CANVAS_WIDTHS).map((resolution) => paginate(READING, resolution, fontSizePx).length);
      for (let i = 1; i < counts.length; i += 1) {
        expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
      }
    }
  });

  test("uses the full reading box height at larger resolutions", () => {
    const longReading = {
      ...READING,
      textLines: Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: The word of the Lord.`)
    };

    for (const resolution of ["1440p", "4k"]) {
      const pages = paginateDocuments([longReading], {
        fontSizePx: 60,
        readingTextHeightPx: DEFAULT_READING_HEIGHTS[resolution],
        readingTextMarginXPx: MARGIN_X_PX,
        canvasWidth: CANVAS_WIDTHS[resolution]
      });
      const fullPages = pages.slice(0, -1);
      const expectedLines = Math.floor(
        DEFAULT_READING_HEIGHTS[resolution] / (60 * LINE_HEIGHT)
      );

      expect(expectedLines).toBeGreaterThanOrEqual(resolution === "4k" ? 15 : 11);
      expect(fullPages.length).toBeGreaterThan(0);
      expect(fullPages.every((slide) => visualLines(slide.text, resolution, 60) >= expectedLines)).toBe(true);
    }
  });

  test("a liturgical ending adds its own slide without moving scripture pages", () => {
    const withEnding = { ...READING, ending: "The word of the Lord." };

    expect(paginate(READING, "1440p", 60)).toHaveLength(6);
    // The cache key ignores the ending text change risk (see issue #168), so clear it first.
    clearPaginationCache();
    const ended = paginate(withEnding, "1440p", 60);
    expect(ended).toHaveLength(7);
    expect(ended[ended.length - 1].isEndingSlide).toBe(true);
    expect(ended[ended.length - 1].isLastPage).toBe(true);
  });
});
