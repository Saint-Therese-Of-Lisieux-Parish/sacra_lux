const {
  createDefaultOrganizer,
  dedupeOrganizerIds,
  findAlternateGroups,
  buildPresentationFromOrganizer,
  normalizeBackgroundTheme,
  normalizePhase,
  normalizeType,
  normalizeSlideshowImages,
  createManualSlideRecord,
  imageSlideshowRuntimeMs
} = require("../../src/organizer");
const { clearPaginationCache } = require("../../src/readingsImporter");

describe("organizer", () => {
  test("paginates a reading for the selected resolution", () => {
    const line = "word ".repeat(30).trim();
    const documents = [{
      stem: "Reading_I",
      section: "Reading I",
      passage: "Isaiah 1:1",
      textLines: Array.from({ length: 12 }, () => line),
      ending: null
    }];
    const pageCount = (resolution) => {
      clearPaginationCache();
      return buildPresentationFromOrganizer({
        title: "T",
        documents,
        sequence: [{ id: "reading:Reading_I", type: "reading", sourceStem: "Reading_I", phase: "mass" }],
        manualSlides: {},
        screenSettings: {
          fontSizePx: 60,
          fontFamily: "Merriweather",
          readingTextHeightPx: 840,
          readingTextMarginXPx: 80,
          resolution
        }
      }).slides.length;
    };

    const pages720 = pageCount("720p");
    const pages4k = pageCount("4k");
    expect(pages720).toBeGreaterThan(pages4k);
  });

  test("repaginates only the reading group with a narrow bounds override", () => {
    const line = "The word of the Lord came to the prophet in the days of the king.";
    const documents = [{
      stem: "Reading_I",
      section: "Reading I",
      passage: "Isaiah 1:1",
      textLines: Array.from({ length: 18 }, () => line),
      ending: null
    }];
    const presentation = buildPresentationFromOrganizer({
      title: "Bounds",
      documents,
      sequence: [
        { id: "reading:global", type: "reading", sourceStem: "Reading_I", phase: "mass" },
        {
          id: "reading:narrow",
          type: "reading",
          sourceStem: "Reading_I",
          phase: "mass",
          styleOverrides: {
            bounds: { body: { left: 600, right: 600, top: 130, bottom: 110 } }
          }
        }
      ],
      manualSlides: {},
      screenSettings: {
        fontSizePx: 60,
        fontFamily: "Merriweather",
        readingTextHeightPx: 840,
        readingTextMarginXPx: 80,
        resolution: "1080p"
      }
    });
    const globalPages = presentation.slides.filter((slide) => slide.organizerItemId === "reading:global");
    const narrowPages = presentation.slides.filter((slide) => slide.organizerItemId === "reading:narrow");

    expect(narrowPages.length).toBeGreaterThan(globalPages.length);
    expect(globalPages[0].styleOverrides.bounds).toBeUndefined();
    expect(narrowPages[0].styleOverrides.bounds.body).toEqual({ left: 600, right: 600, top: 130, bottom: 110 });
  });

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

  test("uses the source filename when the image name is not valid URI text", () => {
    expect(normalizeSlideshowImages([{ url: "/images/%E0%A4%A" }])).toEqual([
      { url: "/images/%E0%A4%A", name: "%E0%A4%A" }
    ]);
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

  test("labels a numbered psalm and an alternate reading from the base section", () => {
    const { sequence } = createDefaultOrganizer([
      { stem: "Responsorial_Psalm_1", section: "Responsorial Psalm (1)" },
      { stem: "Reading_III", section: "Reading III" },
      { stem: "Reading_II-alternate_1", section: "Reading II (Alternate 1)" }
    ]);

    expect(sequence.filter((item) => item.type === "reading").map((item) => item.label)).toEqual([
      "Psalm (1)",
      "Third Reading",
      "Second Reading (Alternate 1)"
    ]);
  });

  test("keeps only the selected text from a group of alternate readings", () => {
    const docs = [
      { stem: "Gospel", section: "Gospel" },
      { stem: "Gospel-alternate_1", section: "Gospel (Alternate 1)" }
    ];

    expect(findAlternateGroups(docs)).toEqual([
      { key: "Gospel", options: ["Gospel", "Gospel-alternate_1"] }
    ]);

    const stems = (options) => createDefaultOrganizer(docs, options).sequence
      .filter((item) => item.type === "reading")
      .map((item) => item.sourceStem);

    expect(stems({ alternateSelections: { Gospel: "Gospel-alternate_1" } })).toEqual(["Gospel-alternate_1"]);
    expect(stems({ alternateSelections: {} })).toEqual(["Gospel"]);
    expect(stems()).toEqual(["Gospel", "Gospel-alternate_1"]);
  });

  test("switching the selected psalm refrain rebuilds the slide list", () => {
    const documents = [{
      stem: "Responsorial_Psalm_1",
      section: "Responsorial Psalm (1)",
      passage: "Psalm 16",
      textLines: [
        "R. (11a) Lord, you will show us the path of life.",
        "or:",
        "R. Alleluia.",
        "Keep me, O God, for in you I take refuge;",
        "R. Alleluia."
      ],
      ending: null
    }];
    const sequence = [{
      id: "reading:psalm",
      type: "reading",
      sourceStem: "Responsorial_Psalm_1",
      label: "Psalm",
      phase: "mass",
      backgroundTheme: "dark",
      psalmRefrainIndex: 1
    }];

    const presentation = buildPresentationFromOrganizer({
      title: "Third Sunday",
      documents,
      sequence,
      manualSlides: {},
      screenSettings: {
        fontSizePx: 60,
        fontFamily: "Merriweather",
        readingTextHeightPx: 840,
        readingTextMarginXPx: 80
      }
    });

    expect(presentation.slides.map((slide) => slide.text)).toEqual([
      "R. Alleluia.",
      "Keep me, O God, for in you I take refuge;",
      "R. Alleluia."
    ]);
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

  test("countdown slides keep lengths up to 60 minutes", () => {
    const build = (countdownSec) => buildPresentationFromOrganizer({
      title: "Countdown",
      documents: [],
      sequence: [{ id: "countdown:long", type: "countdown", label: "Mass starts in", phase: "pre", backgroundTheme: "light" }],
      manualSlides: { "countdown:long": { countdownSec } },
      screenSettings: {
        fontFamily: "Merriweather",
        fontSizePx: 60,
        readingTextHeightPx: 840,
        readingTextSizePx: 0,
        readingLineHeight: 1.58,
        readingTextMarginXPx: 80
      }
    });

    expect(build(600).slides[0].countdownSec).toBe(600);
    expect(build(3600).slides[0].countdownSec).toBe(3600);
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
          countdownSec: 99999,
          countdownFont: "Lora",
          countdownStyle: "bar",
          countdownSizePercent: 140
        }
      },
      screenSettings
    });

    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0].countdownSec).toBe(3600);
    expect(presentation.slides[0].countdownFont).toBe("Lora");
    expect(presentation.slides[0].countdownStyle).toBe("bar");
    expect(presentation.slides[0].countdownSizePercent).toBe(140);
    expect(presentation.slides[0].countdownShowLabel).toBe(false);
    expect(presentation.slides[0].phase).toBe("pre");
  });

  test("countdown font values are whitelisted and fall back to empty", () => {
    const screenSettings = {
      fontFamily: "Merriweather",
      fontSizePx: 60,
      readingTextHeightPx: 840,
      readingTextSizePx: 0,
      readingLineHeight: 1.58,
      readingTextMarginXPx: 80
    };

    const build = (countdownFont) => buildPresentationFromOrganizer({
      title: "Countdown font",
      documents: [],
      sequence: [
        {
          id: "countdown:font",
          type: "countdown",
          label: "Mass starts in",
          phase: "pre",
          backgroundTheme: "light"
        }
      ],
      manualSlides: {
        "countdown:font": {
          countdownSec: 60,
          countdownFont
        }
      },
      screenSettings
    });

    const markupSlide = build('<img src=x onerror=alert(1)>').slides[0];
    expect(markupSlide.countdownFont).toBe("");

    const unknownSlide = build("Comic Sans MS").slides[0];
    expect(unknownSlide.countdownFont).toBe("");

    const validSlide = build("Open Sans").slides[0];
    expect(validSlide.countdownFont).toBe("Open Sans");
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

  test("normalizes image slideshow records and derives one runtime slide per image", () => {
    expect(createManualSlideRecord("imageSlideshow")).toMatchObject({
      images: [],
      slideshowDurationSec: 10,
      slideshowLoopCount: 1
    });
    expect(normalizeSlideshowImages([
      "/api/mass-asset/b-photo.png",
      { url: "/api/mass-asset/a-photo.png", name: "A Photo.png" }
    ])).toEqual([
      { url: "/api/mass-asset/b-photo.png", name: "b-photo.png" },
      { url: "/api/mass-asset/a-photo.png", name: "A Photo.png" }
    ]);

    const presentation = buildPresentationFromOrganizer({
      title: "Slideshow",
      documents: [],
      sequence: [{
        id: "imageSlideshow:announcements",
        type: "imageSlideshow",
        label: "Announcements",
        phase: "pre",
        backgroundTheme: "light"
      }],
      manualSlides: {
        "imageSlideshow:announcements": {
          images: [
            { url: "/api/mass-asset/alpha.png", name: "Alpha.png" },
            { url: "/api/mass-asset/beta.png", name: "Beta.png" }
          ],
          slideshowDurationSec: 7,
          slideshowLoopCount: 3
        }
      },
      screenSettings: {}
    });

    expect(presentation.slides).toHaveLength(2);
    expect(presentation.slides[0]).toMatchObject({
      type: "imageSlideshow",
      imageUrl: "/api/mass-asset/alpha.png",
      slideshowImageName: "Alpha.png",
      slideshowImageIndex: 0,
      slideshowImageCount: 2,
      slideshowDurationSec: 7,
      slideshowLoopCount: 3,
      isFirstPage: true,
      isLastPage: false
    });
    expect(presentation.slides[1]).toMatchObject({
      imageUrl: "/api/mass-asset/beta.png",
      slideshowImageIndex: 1,
      isLastPage: true
    });
  });

  test("keeps an empty slideshow selectable with safe placeholder metadata", () => {
    const presentation = buildPresentationFromOrganizer({
      title: "Empty slideshow",
      documents: [],
      sequence: [{
        id: "imageSlideshow:empty",
        type: "imageSlideshow",
        label: "Empty",
        phase: "mass",
        backgroundTheme: "light"
      }],
      manualSlides: { "imageSlideshow:empty": { images: [] } },
      screenSettings: {}
    });

    expect(presentation.slides).toHaveLength(1);
    expect(presentation.slides[0]).toMatchObject({
      type: "imageSlideshow",
      imageUrl: null,
      slideshowEmpty: true,
      slideshowImageCount: 0
    });
  });

  test("image slideshow runtime keeps crossfades inside image time", () => {
    const manual = {
      images: Array.from({ length: 10 }, (_, index) => ({ url: `/api/mass-asset/${index}.png` })),
      slideshowDurationSec: 5,
      slideshowLoopCount: 1
    };
    expect(imageSlideshowRuntimeMs(manual, "fade")).toBe(50000);
    expect(imageSlideshowRuntimeMs(manual, "none")).toBe(50000);
    expect(imageSlideshowRuntimeMs({ ...manual, slideshowLoopCount: 3 }, "fade")).toBe(150000);
    expect(imageSlideshowRuntimeMs({ images: [] }, "fade")).toBe(0);
  });
});

describe("dedupeOrganizerIds", () => {
  const docs = [{ stem: "Reading_I", sections: [] }, { stem: "Reading_II", sections: [] }];

  test("keeps IDs that do not collide", () => {
    const { sequence, manualSlides } = createDefaultOrganizer(docs);
    const result = dedupeOrganizerIds(sequence, manualSlides, []);
    expect(result.sequence).toEqual(sequence);
    expect(Object.keys(result.manualSlides)).toEqual(Object.keys(manualSlides));
  });

  test("renames colliding items and their manual slide keys", () => {
    const { sequence, manualSlides } = createDefaultOrganizer(docs);
    const taken = sequence.map((item) => item.id);
    const result = dedupeOrganizerIds(sequence, manualSlides, taken);
    const ids = result.sequence.map((item) => item.id);
    expect(ids.some((id) => taken.includes(id))).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
    const imageItem = result.sequence.find((item) => item.type === "image");
    expect(result.manualSlides[imageItem.id]).toBeDefined();
  });
});
