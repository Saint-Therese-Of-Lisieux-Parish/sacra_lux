const { endingForSection } = require("../../src/readingEndings");

describe("endingForSection", () => {
  test("returns the Word of the Lord for readings and the psalm", () => {
    expect(endingForSection("Reading I")).toBe("The Word of the Lord.");
    expect(endingForSection("Responsorial Psalm")).toBe("The Word of the Lord.");
    expect(endingForSection("Epistle")).toBe("The Word of the Lord.");
  });

  test("returns the Gospel ending for the Gospel", () => {
    expect(endingForSection("Gospel")).toBe("The Gospel of the Lord.");
  });

  test("keeps the ending for a variant section", () => {
    expect(endingForSection("Gospel (Alternate 1)")).toBe("The Gospel of the Lord.");
    expect(endingForSection("Reading II (Alternate 2)")).toBe("The Word of the Lord.");
  });

  test("accepts organizer display labels", () => {
    expect(endingForSection("First Reading")).toBe("The Word of the Lord.");
    expect(endingForSection("Psalm")).toBe("The Word of the Lord.");
    expect(endingForSection("Gospel")).toBe("The Gospel of the Lord.");
  });

  test("returns null when no ending applies", () => {
    expect(endingForSection("Verse Before the Gospel")).toBeNull();
    expect(endingForSection("Alleluia")).toBeNull();
    expect(endingForSection("")).toBeNull();
    expect(endingForSection(undefined)).toBeNull();
    expect(endingForSection("constructor")).toBeNull();
  });
});
