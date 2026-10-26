const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  importReadings,
  paginateDocuments,
  clearPaginationCache
} = require("../../src/readingsImporter");

const layout = { fontSizePx: 60, readingTextHeightPx: 840 };

function makeFolder(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readings-errors-"));
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), text, "utf8");
  }
  return root;
}

describe("readingsImporter error paths", () => {
  afterEach(() => {
    clearPaginationCache();
  });

  test("throws a clear error when the readings folder is missing", () => {
    const missing = path.join(os.tmpdir(), "readings-errors-missing-folder");
    expect(() => importReadings(missing, layout)).toThrow(/Readings folder not found/);
  });

  test("skips a reading file with no text", () => {
    const root = makeFolder({
      "Reading_I.txt": "   \n\n",
      "Gospel.txt": "John 1:1\n\nIn the beginning was the Word."
    });
    const result = importReadings(root, layout);
    expect(result.documents.map((d) => d.section)).toEqual(["Gospel"]);
  });

  test("ignores description and passage filename files", () => {
    const root = makeFolder({
      "description.txt": "About this Mass",
      "passage_filenames.txt": "Reading_I.txt",
      "Gospel.txt": "John 1:1\n\nIn the beginning was the Word."
    });
    const result = importReadings(root, layout);
    expect(result.documents).toHaveLength(1);
  });

  test("names an unknown stem from the file name", () => {
    const root = makeFolder({ "special_intention.txt": "Ref 1:1\n\nText." });
    const result = importReadings(root, layout);
    expect(result.documents[0].section).toBe("special intention");
  });

  test("rebuilds an expired cache entry", () => {
    const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: ["a b c"], ending: null }];
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const first = paginateDocuments(docs, layout);
    now.mockReturnValue(1000 + 31 * 60 * 1000);
    const second = paginateDocuments(docs, layout);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  test("evicts the oldest entry when the cache is full", () => {
    const docFor = (n) => [{ stem: `R${n}`, section: "Reading I", passage: "P", textLines: ["a"], ending: null }];
    const first = paginateDocuments(docFor(0), layout);
    for (let n = 1; n <= 50; n++) paginateDocuments(docFor(n), layout);
    expect(paginateDocuments(docFor(0), layout)).not.toBe(first);
  });

  test("splits a very long reading into several pages that fit the screen", () => {
    const sentence = "The word of the Lord came to the prophet in the days of the king.";
    const lines = Array.from({ length: 60 }, () => sentence);
    const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: lines, ending: null }];
    const slides = paginateDocuments(docs, layout);
    expect(slides.length).toBeGreaterThan(3);
    expect(slides.every((s) => s.text.split("\n").length <= 14)).toBe(true);
    expect(slides[slides.length - 1].totalPages).toBe(slides.length);
  });

  test("uses an explicit bounds width for reading line breaks", () => {
    const line = "The word of the Lord came to the prophet in the days of the king.";
    const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: Array(16).fill(line), ending: null }];
    const wide = paginateDocuments(docs, { ...layout, readingTextWidthPx: 1760 });
    clearPaginationCache();
    const narrow = paginateDocuments(docs, { ...layout, readingTextWidthPx: 600 });

    expect(narrow.length).toBeGreaterThan(wide.length);
  });

  test("keeps the scripture text whole when the ending has its own slide", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `Line ${i} of a short reading.`);
    const docs = [{ stem: "R", section: "Gospel", passage: "P", textLines: lines, ending: "The Gospel of the Lord." }];
    const slides = paginateDocuments(docs, { fontSizePx: 60, readingTextHeightPx: 840 });
    const text = slides.filter((s) => !s.isEndingSlide).map((s) => s.text).join("\n").split("\n");
    expect(text).toEqual(lines);
    expect(slides[slides.length - 1].ending).toBe("The Gospel of the Lord.");
  });

  test("groups paragraphs and collapses repeated blank lines", () => {
    const para = (n) => Array.from({ length: 3 }, (_, i) => `Paragraph ${n} line ${i}.`);
    const lines = [...para(1), "", "", ...para(2), "", ...para(3), "", ...para(4), "", ...para(5)];
    const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: lines, ending: null }];
    const slides = paginateDocuments(docs, layout);
    expect(slides.length).toBeGreaterThan(1);
    expect(slides.map((s) => s.text).join("\n")).not.toMatch(/\n\n\n/);
  });

  test("names a variant stem with its suffix", () => {
    const root = makeFolder({ "Gospel-alternate_1.txt": "Ref 1:1\n\nText." });
    expect(importReadings(root).documents[0].section).toBe("Gospel (Alternate 1)");
  });

  test.each([
    ["no options", undefined],
    ["empty options", {}],
    ["text size without height", { readingTextSizePx: 40 }],
    ["out-of-range height and size", { fontSizePx: 1, readingTextHeightPx: 5000, readingLineHeight: 0 }],
    ["wide margin and letter spacing", { canvasWidth: 1000, readingTextMarginXPx: 999 }]
  ])("paginates with %s", (_label, options) => {
    const docs = [{ stem: "R", section: "Gospel", passage: "P", textLines: ["a b c", "d e f"], ending: "The Gospel of the Lord." }];
    const slides = paginateDocuments(docs, options);
    expect(slides.length).toBeGreaterThanOrEqual(1);
    expect(slides[slides.length - 1].isLastPage).toBe(true);
  });

  test("skips a document with no text lines", () => {
    const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: [], ending: null }];
    expect(paginateDocuments(docs, layout)).toEqual([]);
  });
});
