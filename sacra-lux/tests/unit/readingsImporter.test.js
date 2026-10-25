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

describe("spoken reading endings", () => {
  function importEndingFolder() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mass-endings-"));
    fs.writeFileSync(path.join(root, "Reading_I.txt"), "Genesis 1:1\n\nIn the beginning God created the heavens and the earth.", "utf8");
    fs.writeFileSync(path.join(root, "Reading_II.txt"), "Romans 5:1-5\n\nHope does not disappoint.", "utf8");
    fs.writeFileSync(path.join(root, "Responsorial_Psalm.txt"), "Psalm 23\n\nR. The Lord is my shepherd.", "utf8");
    fs.writeFileSync(path.join(root, "Gospel.txt"), "John 1:1-5\n\nIn the beginning was the Word.", "utf8");
    return importReadings(root, {
      fontSizePx: 60,
      fontFamily: "Merriweather",
      readingTextHeightPx: 840
    });
  }

  test("assigns the spoken ending by section", () => {
    const result = importEndingFolder();
    const endings = Object.fromEntries(result.documents.map((doc) => [doc.section, doc.ending]));

    expect(endings["Reading I"]).toBe("The Word of the Lord.");
    expect(endings["Reading II"]).toBe("The Word of the Lord.");
    expect(endings["Responsorial Psalm"]).toBe("The Word of the Lord.");
    expect(endings.Gospel).toBe("The Gospel of the Lord.");
  });

  test("shows the spoken ending only on the last page", () => {
    const longText = Array.from({ length: 24 }, (_, index) => `Line ${index + 1} of the reading.`);
    const slides = paginateDocuments([
      {
        stem: "Reading_I",
        section: "Reading I",
        passage: "Genesis 1:1",
        textLines: longText,
        ending: "The Word of the Lord."
      }
    ], {
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextMarginXPx: 80
    });

    expect(slides.length).toBeGreaterThan(1);
    expect(slides.slice(0, -1).every((slide) => slide.ending === null)).toBe(true);
    expect(slides[slides.length - 1].ending).toBe("The Word of the Lord.");
  });
});

describe("pagination cache key", () => {
  const { paginateDocuments, clearPaginationCache } = require("../../src/readingsImporter");
  const docs = [{ stem: "R", section: "Reading I", passage: "P", textLines: ["a b c"], ending: null }];
  const base = { fontSizePx: 60, readingTextHeightPx: 840 };

  test.each([
    ["readingTextFont", "Lora"],
    ["readingTextBold", true],
    ["readingTextItalic", true],
    ["readingLetterSpacingPx", 4]
  ])("rebuilds page breaks when %s changes", (key, value) => {
    clearPaginationCache();
    const first = paginateDocuments(docs, base);
    expect(paginateDocuments(docs, base)).toBe(first);
    expect(paginateDocuments(docs, { ...base, [key]: value })).not.toBe(first);
  });

  describe("document fields that change paging", () => {
    const verse = "Verse: the word of the Lord came to the prophet in the days of the king, and he spoke to the people.";
    const lines = Array.from({ length: 24 }, () => verse);
    const layout = { fontSizePx: 60, readingTextHeightPx: 840, readingTextMarginXPx: 80, canvasWidth: 2560 };
    const reading = { stem: "R", section: "Reading I", passage: "P", textLines: lines, ending: null };

    function coldPageCount(doc) {
      clearPaginationCache();
      return paginateDocuments([doc], layout).length;
    }

    test("returns separate slides when only the ending differs", () => {
      const withEnding = { ...reading, ending: "The word of the Lord." };
      const expectedPlain = coldPageCount(reading);
      const expectedEnded = coldPageCount(withEnding);
      expect(expectedEnded).not.toBe(expectedPlain);

      clearPaginationCache();
      expect(paginateDocuments([reading], layout)).toHaveLength(expectedPlain);
      expect(paginateDocuments([withEnding], layout)).toHaveLength(expectedEnded);
    });

    test("returns separate slides when only the section differs", () => {
      const psalm = { ...reading, section: "Responsorial Psalm", textLines: ["R. Refrain", ...lines, "R. Refrain"] };
      const asReading = { ...psalm, section: "Reading I" };
      const expectedPsalm = paginateDocuments([psalm], { ...layout, canvasWidth: 1920 });
      clearPaginationCache();
      const expectedReading = paginateDocuments([asReading], { ...layout, canvasWidth: 1920 });
      expect(expectedPsalm.map((slide) => slide.text)).not.toEqual(expectedReading.map((slide) => slide.text));

      clearPaginationCache();
      const first = paginateDocuments([asReading], { ...layout, canvasWidth: 1920 });
      const second = paginateDocuments([psalm], { ...layout, canvasWidth: 1920 });
      expect(first.map((slide) => slide.text)).toEqual(expectedReading.map((slide) => slide.text));
      expect(second.map((slide) => slide.text)).toEqual(expectedPsalm.map((slide) => slide.text));
    });
  });
});

describe("long single paragraph pagination", () => {
  test("splits one long source line into pages that fit the box", () => {
    const sentence = "Behold, I will make those of the assembly of Satan fall prostrate at your feet.";
    const docs = [{
      stem: "long",
      section: "First Reading",
      passage: "Revelation 3:9",
      textLines: [Array.from({ length: 12 }, () => sentence).join(" ")],
      ending: null
    }];
    const slides = paginateDocuments(docs, {
      fontSizePx: 60,
      readingTextHeightPx: 400,
      readingTextWidthPx: 1000,
      readingLineHeight: 1.5
    });

    expect(slides.length).toBeGreaterThan(1);
    expect(slides.map((slide) => slide.text).join(" ").replace(/\s+/g, " ")).toBe(docs[0].textLines[0]);
  });
});
