const fs = require("fs");
const os = require("os");
const path = require("path");

const { importReadings, paginateDocuments } = require("../../src/readingsImporter");

describe("readingsImporter", () => {
  test("imports and orders readings from folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mass-readings-"));

    fs.writeFileSync(path.join(root, "mass_title.txt"), "Palm Sunday", "utf8");
    fs.writeFileSync(path.join(root, "Gospel.txt"), "John 12:12-16\n\nHosanna in the highest.", "utf8");
    fs.writeFileSync(path.join(root, "Reading_I.txt"), "Isaiah 50:4-7\n\nThe Lord GOD has given me a well-trained tongue.", "utf8");

    const result = importReadings(root, {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840
    });

    expect(result.title).toBe("Palm Sunday");
    expect(result.documents.map((d) => d.section)).toEqual(["Reading I", "Gospel"]);
    expect(result.documents[0].passage).toBe("Isaiah 50:4-7");
    expect(result.slides.length).toBeGreaterThanOrEqual(2);
  });

  test("splits narrative readings on hard break markers", () => {
    const docs = [
      {
        stem: "Reading_I",
        section: "Reading I",
        passage: "Genesis 1:1",
        textLines: ["Line one", "---", "Line two"],
        ending: null
      }
    ];

    const slides = paginateDocuments(docs, {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840,
      readingTextMarginXPx: 80
    });

    expect(slides).toHaveLength(2);
    expect(slides[0].text).toBe("Line one");
    expect(slides[1].text).toBe("Line two");
  });

  test("forces psalm refrain lines onto their own slides", () => {
    const docs = [
      {
        stem: "Responsorial_Psalm",
        section: "Responsorial Psalm",
        passage: "Psalm 23",
        textLines: [
          "R. The Lord is my shepherd.",
          "He guides me along right paths.",
          "R. The Lord is my shepherd."
        ],
        ending: null
      }
    ];

    const slides = paginateDocuments(docs, {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840,
      readingTextMarginXPx: 80
    });

    expect(slides).toHaveLength(3);
    expect(slides[0].text).toBe("R. The Lord is my shepherd.");
    expect(slides[1].text).toBe("He guides me along right paths.");
    expect(slides[2].text).toBe("R. The Lord is my shepherd.");
  });
});
