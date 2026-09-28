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

  function importNamedFiles(folderName, filenames) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "parish-readings-"));
    const folder = path.join(root, folderName);
    fs.mkdirSync(folder);
    for (const filename of filenames) {
      fs.writeFileSync(path.join(folder, filename), "Citation 1:1\n\nSample text.", "utf8");
    }
    return importReadings(folder, {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840
    }).documents.map((doc) => doc.section);
  }

  test("imports parish reading filenames in liturgical order", () => {
    expect(importNamedFiles("Third_Sunday_of_Easter", [
      "Gospel.txt",
      "Reading_1.txt",
      "Reading_2.txt",
      "Responsorial_Psalm_1.txt"
    ])).toEqual([
      "Responsorial Psalm (1)",
      "Reading I",
      "Reading II",
      "Gospel"
    ]);

    expect(importNamedFiles("Easter_Sunday", [
      "Gospel-alternate_1.txt",
      "Gospel.txt",
      "Reading_1.txt",
      "Reading_2-alternate_1.txt",
      "Reading_2.txt",
      "Responsorial_Psalm_1.txt"
    ])).toEqual([
      "Responsorial Psalm (1)",
      "Reading I",
      "Reading II",
      "Reading II (Alternate 1)",
      "Gospel",
      "Gospel (Alternate 1)"
    ]);

    expect(importNamedFiles("Easter_Vigil", [
      "Epistle.txt",
      "Gospel.txt",
      "Reading_I-alternate_1.txt",
      "Reading_I-alternate_2.txt",
      "Reading_I.txt",
      "Reading_II-alternate_1.txt",
      "Reading_II.txt",
      "Reading_III.txt",
      "Reading_IV.txt",
      "Reading_V.txt",
      "Reading_VI.txt",
      "Reading_VII-alternate_1.txt",
      "Reading_VII-alternate_2.txt",
      "Reading_VII.txt",
      "Responsorial_Psalm_1.txt",
      "Responsorial_Psalm_2.txt",
      "Responsorial_Psalm_3.txt",
      "Responsorial_Psalm_4.txt",
      "Responsorial_Psalm_5.txt",
      "Responsorial_Psalm_6.txt",
      "Responsorial_Psalm_7.txt",
      "Responsorial_Psalm_8.txt"
    ])).toEqual([
      "Responsorial Psalm (1)",
      "Responsorial Psalm (2)",
      "Responsorial Psalm (3)",
      "Responsorial Psalm (4)",
      "Responsorial Psalm (5)",
      "Responsorial Psalm (6)",
      "Responsorial Psalm (7)",
      "Responsorial Psalm (8)",
      "Reading I",
      "Reading I (Alternate 1)",
      "Reading I (Alternate 2)",
      "Reading II",
      "Reading II (Alternate 1)",
      "Reading III",
      "Reading IV",
      "Reading V",
      "Reading VI",
      "Reading VII",
      "Reading VII (Alternate 1)",
      "Reading VII (Alternate 2)",
      "Epistle",
      "Gospel"
    ]);
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

  test("projects one selected psalm refrain and skips an or: slide", () => {
    const docs = [
      {
        stem: "Responsorial_Psalm_1",
        section: "Responsorial Psalm (1)",
        passage: "Psalm 16:1-2, 5, 7-8, 9-10, 11",
        textLines: [
          "R. (11a) Lord, you will show us the path of life.",
          "or:",
          "R. Alleluia.",
          "Keep me, O God, for in you I take refuge;",
          "R. Lord, you will show us the path of life.",
          "or:",
          "R. Alleluia.",
          "I bless the LORD who counsels me;",
          "R. Lord, you will show us the path of life.",
          "or:",
          "R. Alleluia."
        ],
        ending: null
      }
    ];
    const settings = {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840,
      readingTextMarginXPx: 80
    };

    const sunday = paginateDocuments(docs, { ...settings, psalmRefrainIndex: 0 });
    expect(sunday.map((slide) => slide.text)).toEqual([
      "R. (11a) Lord, you will show us the path of life.",
      "Keep me, O God, for in you I take refuge;",
      "R. (11a) Lord, you will show us the path of life.",
      "I bless the LORD who counsels me;",
      "R. (11a) Lord, you will show us the path of life."
    ]);
    expect(sunday.some((slide) => slide.text.trim().toLowerCase() === "or:")).toBe(false);

    const alleluia = paginateDocuments(docs, { ...settings, psalmRefrainIndex: 1 });
    expect(alleluia.map((slide) => slide.text)).toEqual([
      "R. Alleluia.",
      "Keep me, O God, for in you I take refuge;",
      "R. Alleluia.",
      "I bless the LORD who counsels me;",
      "R. Alleluia."
    ]);
    expect(alleluia.some((slide) => /path of life/i.test(slide.text))).toBe(false);
  });
});
