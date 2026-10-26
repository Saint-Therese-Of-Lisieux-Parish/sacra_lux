const { sanitizePdfFileName } = require("../../src/pdfFileName");

describe("sanitizePdfFileName", () => {
  test("keeps Unicode letters and digits", () => {
    expect(sanitizePdfFileName("Día de Todos los Santos", "Mass"))
      .toBe("Día de Todos los Santos");
  });

  test("removes file system reserved and control characters", () => {
    expect(sanitizePdfFileName("A/B:C\u0000", "Mass")).toBe("ABC");
  });

  test("uses the given fallback when the cleaned name is empty", () => {
    expect(sanitizePdfFileName("***", "Mass")).toBe("Mass");
    expect(sanitizePdfFileName("***", "Slide")).toBe("Slide");
  });
});
