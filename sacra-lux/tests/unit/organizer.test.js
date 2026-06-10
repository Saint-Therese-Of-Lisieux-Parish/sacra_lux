const {
  createDefaultOrganizer,
  buildPresentationFromOrganizer,
  normalizeBackgroundTheme,
  normalizePhase,
  normalizeType,
  createManualSlideRecord
} = require("../../src/organizer");

describe("organizer", () => {
  test("normalizes legacy values", () => {
    expect(normalizeType("reading-group")).toBe("reading");
    expect(normalizeType("graphic")).toBe("image");
    expect(normalizeType("unknown")).toBe("text");

    expect(normalizePhase("warmup")).toBe("gathering");
    expect(normalizePhase("bogus")).toBe("mass");

    expect(normalizeBackgroundTheme("word", "text")).toBe("dark");
    expect(normalizeBackgroundTheme("graphic", "text")).toBe("light");
    expect(normalizeBackgroundTheme(null, "image")).toBe("light");
    expect(normalizeBackgroundTheme(null, "text")).toBe("dark");
  });

  test("creates expected default organizer sequence", () => {
    const docs = [
      { stem: "Reading_I", section: "Reading I" },
      { stem: "Gospel", section: "Gospel" }
    ];

    const { sequence, manualSlides } = createDefaultOrganizer(docs);

    expect(sequence).toEqual([
      {
        id: "reading:Reading_I",
        type: "reading",
        sourceStem: "Reading_I",
        label: "First Reading",
        phase: "mass",
        backgroundTheme: "dark"
      },
      {
        id: "image:Reading_I:1",
        type: "image",
        label: "Image",
        phase: "mass",
        backgroundTheme: "light"
      },
      {
        id: "reading:Gospel",
        type: "reading",
        sourceStem: "Gospel",
        label: "Gospel",
        phase: "mass",
        backgroundTheme: "dark"
      }
    ]);

    expect(manualSlides["image:Reading_I:1"]).toEqual(createManualSlideRecord("image"));
  });

  test("builds manual text slides with hard breaks", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const presentation = buildPresentationFromOrganizer({
      title: "Test Mass",
      documents: [],
      sequence: [
        {
          id: "text:intro",
          type: "text",
          label: "Welcome",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:intro": {
          text: "Welcome everyone\n---\nPlease stand",
          notes: "app note",
          textVAlign: "top",
          imageUrl: null,
          styleOverrides: {
            fontFamily: "Lora",
            fontSizePx: 84,
            bold: true,
            italic: false,
            outline: true,
            shadow: false
          }
        }
      },
      screenSettings
    });

    expect(presentation.slides).toHaveLength(2);
    expect(presentation.slides[0].title).toBe("Welcome (1/2)");
    expect(presentation.slides[0].text).toBe("Welcome everyone");
    expect(presentation.slides[1].title).toBe("Welcome (2/2)");
    expect(presentation.slides[1].text).toBe("Please stand");
    expect(presentation.slides[1].index).toBe(1);
    expect(presentation.slides[0].styleOverrides).toEqual({
      fontFamily: "Lora",
      fontSizePx: 84,
      bold: true,
      italic: false,
      outline: true,
      shadow: false
    });
  });

  test("applies reading style overrides to generated slides", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const presentation = buildPresentationFromOrganizer({
      title: "Reading Override",
      documents: [
        {
          stem: "Reading_I",
          section: "Reading I",
          passage: "Genesis 1:1-3",
          textLines: ["In the beginning God created the heavens and the earth."],
          ending: null
        }
      ],
      sequence: [
        {
          id: "reading:Reading_I",
          type: "reading",
          sourceStem: "Reading_I",
          label: "First Reading",
          phase: "mass",
          backgroundTheme: "dark",
          styleOverrides: {
            fontFamily: "Playfair Display",
            fontSizePx: 74,
            bold: true,
            italic: true,
            outline: true,
            shadow: false
          }
        }
      ],
      manualSlides: {},
      screenSettings
    });

    expect(presentation.slides[0].styleOverrides).toEqual({
      fontFamily: "Playfair Display",
      fontSizePx: 74,
      bold: true,
      italic: true,
      outline: true,
      shadow: false
    });
  });

  test("does not create a blank slide after a refrain-only page", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const presentation = buildPresentationFromOrganizer({
      title: "Psalm Response",
      documents: [],
      sequence: [
        {
          id: "text:psalm-response",
          type: "text",
          label: "Psalm Response",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:psalm-response": {
          text: "Verse line one\nR. The Lord is kind and merciful.",
          notes: "",
          textVAlign: "middle",
          imageUrl: null
        }
      },
      screenSettings
    });

    expect(presentation.slides).toHaveLength(2);
    expect(presentation.slides[0].text).toBe("Verse line one");
    expect(presentation.slides[1].text).toBe("R. The Lord is kind and merciful.");
  });

  test("countdown slides are clamped and include metadata", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const presentation = buildPresentationFromOrganizer({
      title: "Countdown",
      documents: [],
      sequence: [
        {
          id: "countdown:entry",
          type: "countdown",
          label: "Mass starts in",
          phase: "pre",
          backgroundTheme: "light"
        }
      ],
      manualSlides: {
        "countdown:entry": {
          countdownSec: 999,
          countdownFont: "Lora",
          countdownStyle: "bar",
          countdownSizePercent: 140
        }
      },
      screenSettings
    });

    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0].countdownSec).toBe(300);
    expect(presentation.slides[0].countdownFont).toBe("Lora");
    expect(presentation.slides[0].countdownStyle).toBe("bar");
    expect(presentation.slides[0].countdownSizePercent).toBe(140);
    expect(presentation.slides[0].countdownShowLabel).toBe(false);
    expect(presentation.slides[0].phase).toBe("pre");
  });

  test("movie slides stay single-page and carry playback metadata", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const presentation = buildPresentationFromOrganizer({
      title: "Video Test",
      documents: [],
      sequence: [
        {
          id: "movie:intro",
          type: "movie",
          label: "Welcome Video",
          phase: "mass",
          backgroundTheme: "light"
        }
      ],
      manualSlides: {
        "movie:intro": {
          text: "Welcome video",
          videoUrl: "/api/mass-asset/welcome.mp4",
          videoLoop: false,
          videoAutoAdvance: true
        }
      },
      screenSettings
    });

    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0]).toMatchObject({
      type: "movie",
      title: "Welcome Video",
      videoUrl: "/api/mass-asset/welcome.mp4",
      videoLoop: false,
      videoAutoAdvance: true
    });
  });
});
