const {
  ValidationError,
  assetRefFromUrl,
  assetUrlFromRef,
  buildMassDocumentFromLegacyPackage,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  isMassDocumentV3,
  serializeReadingDocument,
  validateMassDocument
} = require("../../src/massDocument");

function baseDocument(items = []) {
  return {
    format: "sacra-lux.mass",
    version: 3,
    metadata: { title: "Test Mass" },
    items
  };
}

function textItem(overrides = {}) {
  return {
    id: "t1",
    kind: "text",
    label: "Welcome",
    section: "mass",
    content: { text: "Hello" },
    ...overrides
  };
}

function docWithItem(overrides = {}) {
  return baseDocument([textItem(overrides)]);
}

function expectRejected(document, pattern) {
  expect(() => validateMassDocument(document)).toThrow(ValidationError);
  expect(() => validateMassDocument(document)).toThrow(pattern);
}

describe("massDocument validation: top level", () => {
  test.each([
    ["a null document", null, /Mass document must be an object/],
    ["an array document", [], /Mass document must be an object/],
    ["an unknown top-level key", { ...baseDocument(), extra: 1 }, /unknown key "extra"/],
    ["a wrong format", { ...baseDocument(), format: "other" }, /format must be/],
    ["a missing format", { ...baseDocument(), format: undefined }, /format must be/],
    ["a non-object presentationDefaults", { ...baseDocument(), presentationDefaults: "x" }, /presentationDefaults must be an object/],
    ["a non-object assets", { ...baseDocument(), assets: [] }, /assets must be an object/],
    ["a missing items array", { ...baseDocument(), items: undefined }, /items must be an array/],
    ["a non-array items", { ...baseDocument(), items: {} }, /items must be an array/]
  ])("rejects %s", (_name, document, pattern) => {
    expectRejected(document, pattern);
  });

  test.each([1, 2, 4, "3", null, undefined])("rejects document version %p", (version) => {
    expectRejected({ ...baseDocument(), version }, /version must be 3/);
  });

  test.each([
    ["a missing title", {}, /metadata.title/],
    ["an empty title", { title: "  " }, /metadata.title/],
    ["a numeric title", { title: 5 }, /metadata.title/],
    ["an unknown metadata key", { title: "A", bogus: true }, /unknown key "bogus"/],
    ["a non-string scheduledStart", { title: "A", scheduledStart: 12 }, /metadata.scheduledStart/],
    ["an unparsable scheduledStart", { title: "A", scheduledStart: "not a date" }, /valid datetime/]
  ])("rejects metadata with %s", (_name, metadata, pattern) => {
    expectRejected({ ...baseDocument(), metadata }, pattern);
  });

  test("rejects a missing metadata object", () => {
    expectRejected({ ...baseDocument(), metadata: undefined }, /metadata.title/);
  });

  test("rejects a non-object metadata value", () => {
    expectRejected({ ...baseDocument(), metadata: [] }, /metadata must be an object/);
  });

  test("accepts a document with no items and a valid scheduledStart", () => {
    const document = { ...baseDocument(), metadata: { title: "A", scheduledStart: "2026-04-12T10:30:00-04:00" } };
    expect(validateMassDocument(document)).toBe(document);
  });
});

describe("massDocument validation: items", () => {
  test.each([
    ["a non-object item", ["nope"], /item must be an object/],
    ["an unknown item key", [textItem({ extra: 1 })], /unknown key "extra"/],
    ["a missing id", [textItem({ id: undefined })], /item.id/],
    ["an empty id", [textItem({ id: "" })], /item.id/],
    ["a missing kind", [textItem({ kind: undefined })], /Unsupported kind/],
    ["an unknown kind", [textItem({ kind: "video" })], /Unsupported kind "video"/],
    ["a missing section", [textItem({ section: undefined })], /Unsupported section/],
    ["an unknown section", [textItem({ section: "nave" })], /Unsupported section "nave"/],
    ["a missing label", [textItem({ label: undefined })], /item.label/],
    ["a blank label", [textItem({ label: " " })], /item.label/],
    ["a zero duration", [textItem({ durationSec: 0 })], /durationSec/],
    ["a fractional duration", [textItem({ durationSec: 1.5 })], /durationSec/],
    ["a too-large duration", [textItem({ durationSec: 3601 })], /durationSec/],
    ["a non-numeric duration", [textItem({ durationSec: "abc" })], /durationSec/],
    ["non-string notes", [textItem({ notes: 4 })], /item.notes must be a string/]
  ])("rejects %s", (_name, items, pattern) => {
    expectRejected(baseDocument(items), pattern);
  });

  test("accepts the legacy warmup section and null duration", () => {
    expect(() => validateMassDocument(docWithItem({ section: "warmup", durationSec: null }))).not.toThrow();
  });

  test("accepts a valid duration at both limits", () => {
    expect(() => validateMassDocument(docWithItem({ durationSec: 1 }))).not.toThrow();
    expect(() => validateMassDocument(docWithItem({ durationSec: 3600 }))).not.toThrow();
  });

  test.each(["pre", "gathering", "mass", "post"])("accepts section %s", (section) => {
    expect(() => validateMassDocument(docWithItem({ section }))).not.toThrow();
  });
});

describe("massDocument validation: content by kind", () => {
  test.each([
    ["text with a numeric text value", textItem({ content: { text: 4 } }), /content.text must be a string/],
    ["text with seconds", textItem({ content: { text: "a", seconds: 5 } }), /seconds is not allowed/],
    ["text with an unknown content key", textItem({ content: { text: "a", zzz: 1 } }), /unknown key "zzz"/],
    ["text with array content", textItem({ content: [] }), /item.content must be an object/],
    ["text with no content", textItem({ content: undefined }), /requires item.content/],
    ["prayer with no content", textItem({ kind: "prayer", content: undefined }), /requires item.content/],
    ["countdown with no content", textItem({ kind: "countdown", content: undefined }), /require item.content/],
    ["countdown with zero seconds", textItem({ kind: "countdown", content: { seconds: 0 } }), /between 1 and 3600/],
    ["countdown with too many seconds", textItem({ kind: "countdown", content: { seconds: 3601 } }), /between 1 and 3600/],
    ["countdown with fractional seconds", textItem({ kind: "countdown", content: { seconds: 1.5 } }), /between 1 and 3600/],
    ["countdown with text", textItem({ kind: "countdown", content: { seconds: 10, text: "x" } }), /do not allow content.text/],
    ["image with non-string text", textItem({ kind: "image", content: { text: 3 } }), /image item content.text must be a string/],
    ["movie with seconds", textItem({ kind: "movie", content: { seconds: 3 } }), /movie items do not allow content.seconds/],
    ["image with non-boolean autoAdvance", textItem({ kind: "image", content: { autoAdvance: "yes" } }), /autoAdvance must be a boolean/],
    ["interstitial with non-string text", textItem({ kind: "interstitial", content: { text: 9 } }), /interstitial item content.text/],
    ["interstitial with seconds", textItem({ kind: "interstitial", content: { seconds: 9 } }), /interstitial items do not allow content.seconds/],
    ["slideshow with no content", textItem({ kind: "imageSlideshow", content: undefined, assets: [] }), /require item.content/],
    ["slideshow with zero secondsPerImage", textItem({ kind: "imageSlideshow", content: { secondsPerImage: 0, loopCount: 1 }, assets: [] }), /secondsPerImage/],
    ["slideshow with zero loopCount", textItem({ kind: "imageSlideshow", content: { secondsPerImage: 5, loopCount: 0 }, assets: [] }), /loopCount/],
    ["slideshow with too many loops", textItem({ kind: "imageSlideshow", content: { secondsPerImage: 5, loopCount: 1001 }, assets: [] }), /loopCount/],
    ["slideshow with extra content", textItem({ kind: "imageSlideshow", content: { secondsPerImage: 5, loopCount: 1, text: "a" }, assets: [] }), /only supports secondsPerImage and loopCount/]
  ])("rejects %s", (_name, item, pattern) => {
    expectRejected(baseDocument([item]), pattern);
  });

  test.each([
    ["countdown", { seconds: 60 }],
    ["image", { text: "caption", autoAdvance: true }],
    ["movie", {}],
    ["interstitial", { text: "Please wait" }],
    ["interstitial", {}]
  ])("accepts valid %s content", (kind, content) => {
    expect(() => validateMassDocument(docWithItem({ kind, content }))).not.toThrow();
  });
});

describe("massDocument validation: source, asset, and assets", () => {
  test.each(["image", "imageSlideshow", "movie", "interstitial", "countdown"])("rejects item.source on kind %s", (kind) => {
    const item = textItem({ kind, content: { seconds: 5, secondsPerImage: 5, loopCount: 1 }, source: { stem: "a" } });
    if (kind === "imageSlideshow") item.assets = [];
    if (kind === "countdown") item.content = { seconds: 5 };
    if (kind === "imageSlideshow") item.content = { secondsPerImage: 5, loopCount: 1 };
    if (!["countdown", "imageSlideshow"].includes(kind)) item.content = {};
    expectRejected(baseDocument([item]), /item.source is not allowed/);
  });

  test("rejects a non-object source and an unknown source key", () => {
    expectRejected(docWithItem({ source: "x" }), /item.source must be an object/);
    expectRejected(docWithItem({ source: { bogus: 1 } }), /unknown key "bogus"/);
  });

  test("accepts a source on a reading item", () => {
    expect(() => validateMassDocument(docWithItem({ kind: "reading", source: { stem: "Reading_I", citation: "Is 1:1" } }))).not.toThrow();
  });

  test.each([
    ["a non-object asset", "x", /item.asset must be an object/],
    ["an unknown asset key", { ref: "assets/a.png", extra: 1 }, /unknown key "extra"/],
    ["an empty asset ref", { ref: "" }, /item.asset.ref/],
    ["an asset ref outside assets/", { ref: "../a.png" }, /Unsupported asset ref/],
    ["a nested asset ref", { ref: "assets/a/b.png" }, /Unsupported asset ref/]
  ])("rejects %s on an image item", (_name, asset, pattern) => {
    expectRejected(baseDocument([textItem({ kind: "image", content: {}, asset })]), pattern);
  });

  test.each(["text", "prayer", "hymn", "reading", "countdown"])("rejects item.asset on kind %s", (kind) => {
    const content = kind === "countdown" ? { seconds: 5 } : { text: "a" };
    expectRejected(baseDocument([textItem({ kind, content, asset: { ref: "assets/a.png" } })]), /item.asset is not allowed/);
  });

  test("accepts an asset on an image item", () => {
    expect(() => validateMassDocument(baseDocument([textItem({ kind: "image", content: {}, asset: { ref: "assets/a.png" } })]))).not.toThrow();
  });

  test("rejects item.assets on a non-slideshow kind", () => {
    expectRejected(docWithItem({ assets: [] }), /item.assets is not allowed for kind "text"/);
  });

  const slideshow = (assets) => textItem({
    kind: "imageSlideshow",
    content: { secondsPerImage: 5, loopCount: 1 },
    assets
  });

  test.each([
    ["a non-array assets value", {}, /assets must be an array/],
    ["too many assets", Array.from({ length: 501 }, (_v, i) => ({ ref: `assets/${i}.png` })), /more than 500/],
    ["a non-object entry", ["x"], /assets entry must be an object/],
    ["an unknown entry key", [{ ref: "assets/a.png", bogus: 1 }], /unknown key "bogus"/],
    ["an empty entry ref", [{ ref: "" }], /entry ref/],
    ["a bad entry ref", [{ ref: "a.png" }], /Unsupported asset ref/],
    ["a non-string entry name", [{ ref: "assets/a.png", name: 4 }], /name must be a string/]
  ])("rejects slideshow with %s", (_name, assets, pattern) => {
    expectRejected(baseDocument([slideshow(assets)]), pattern);
  });

  test("rejects item.asset on a slideshow", () => {
    expectRejected(baseDocument([{ ...slideshow([]), asset: { ref: "assets/a.png" } }]), /use item.assets instead of item.asset|item.asset is not allowed/);
  });

  test("accepts a slideshow with named assets", () => {
    expect(() => validateMassDocument(baseDocument([slideshow([{ ref: "assets/a.png", name: "A" }, { ref: "assets/b.png" }])]))).not.toThrow();
  });
});

describe("massDocument validation: presentation", () => {
  test.each([
    ["a non-object presentation", "x", /item.presentation must be an object/],
    ["an unknown presentation key", { zzz: 1 }, /unknown key "zzz"/],
    ["an unsupported background", { background: "blue" }, /Unsupported presentation.background/],
    ["an unsupported textAlign", { textAlign: "justify" }, /Unsupported presentation.textAlign/],
    ["an unsupported textVAlign", { textVAlign: "center" }, /Unsupported presentation.textVAlign/],
    ["a non-string fontFamily", { fontFamily: 5 }, /fontFamily must be a string/],
    ["a too-small fontSizePx", { fontSizePx: 23 }, /fontSizePx must be between/],
    ["a too-large fontSizePx", { fontSizePx: 201 }, /fontSizePx must be between/],
    ["a non-numeric fontSizePx", { fontSizePx: "big" }, /fontSizePx must be between/],
    ["a non-boolean bold", { bold: "yes" }, /presentation.bold must be a boolean/],
    ["a non-boolean italic", { italic: 1 }, /presentation.italic must be a boolean/],
    ["a non-boolean outline", { outline: "x" }, /presentation.outline must be a boolean/],
    ["a non-boolean shadow", { shadow: 0 }, /presentation.shadow must be a boolean/],
    ["an unsupported countdownStyle", { countdownStyle: "sundial" }, /Unsupported presentation.countdownStyle/],
    ["a too-small countdownSizePercent", { countdownSizePercent: 49 }, /countdownSizePercent must be between/],
    ["a too-large countdownSizePercent", { countdownSizePercent: 201 }, /countdownSizePercent must be between/],
    ["a non-boolean loop", { loop: "no" }, /presentation.loop must be a boolean/],
    ["a negative psalmRefrainIndex", { psalmRefrainIndex: -1 }, /psalmRefrainIndex/],
    ["a fractional psalmRefrainIndex", { psalmRefrainIndex: 1.5 }, /psalmRefrainIndex/]
  ])("rejects %s", (_name, presentation, pattern) => {
    expectRejected(docWithItem({ presentation }), pattern);
  });

  test("accepts a full valid presentation", () => {
    const presentation = {
      background: "dark",
      textAlign: "left",
      textVAlign: "bottom",
      fontFamily: "Lora",
      fontSizePx: 72,
      bold: true,
      italic: false,
      outline: true,
      shadow: false,
      countdownStyle: "ring",
      countdownSizePercent: 100,
      loop: true,
      psalmRefrainIndex: 0
    };
    expect(() => validateMassDocument(docWithItem({ presentation }))).not.toThrow();
  });
});

describe("massDocument helpers and round trips", () => {
  test("maps asset URLs to refs and back", () => {
    expect(assetRefFromUrl("/api/mass-asset/a.png")).toBe("assets/a.png");
    expect(assetRefFromUrl("/static/uploads/b.png")).toBe("assets/b.png");
    expect(assetRefFromUrl("/elsewhere/c.png")).toBeNull();
    expect(assetRefFromUrl(null)).toBeNull();
    expect(assetUrlFromRef("assets/a.png")).toBe("/api/mass-asset/a.png");
    expect(() => assetUrlFromRef("a.png")).toThrow(ValidationError);
    expect(() => assetUrlFromRef(undefined)).toThrow(ValidationError);
  });

  test("rejects encoded path separators in asset URLs", () => {
    expect(assetRefFromUrl("/api/mass-asset/..%2Fx.png")).toBeNull();
    expect(assetRefFromUrl("/api/mass-asset/%2E%2E%5Cx.png")).toBeNull();
    expect(assetRefFromUrl("/api/mass-asset/a%2Fb.png")).toBeNull();
  });

  test("detects v3 documents", () => {
    expect(isMassDocumentV3({ format: "sacra-lux.mass", version: 3 })).toBe(true);
    expect(isMassDocumentV3({ format: "sacra-lux.mass", version: 2 })).toBe(false);
    expect(isMassDocumentV3({ format: "other", version: 3 })).toBe(false);
    expect(isMassDocumentV3([])).toBe(false);
    expect(isMassDocumentV3(null)).toBe(false);
    expect(isMassDocumentV3("x")).toBe(false);
  });

  test("serializes a reading document with passage, section, or stem fallback", () => {
    expect(serializeReadingDocument({ passage: "Is 1:1", textLines: ["a", "b  "] })).toBe("Is 1:1\n\na\nb\n");
    expect(serializeReadingDocument({ section: "First Reading", textLines: [] })).toBe("First Reading\n");
    expect(serializeReadingDocument({ stem: "Reading_I" })).toBe("Reading_I\n");
  });

  function fullState() {
    return {
      presentation: { title: "Round Trip" },
      massStartTime: "2026-04-12T10:30:00-04:00",
      screenSettings: {
        fontFamily: "Merriweather",
        darkBackgroundUrl: "/api/mass-asset/dark.jpg",
        lightBackgroundUrl: "/api/mass-asset/light.jpg"
      },
      organizerSequence: [
        { id: "pre-count", type: "countdown", label: "Countdown", phase: "pre", backgroundTheme: "dark", durationSec: 120 },
        { id: "reading-1", type: "reading", label: "First Reading", phase: "mass", backgroundTheme: "dark", sourceStem: "Reading_I", durationSec: 10 },
        { id: "hymn-1", type: "hymn", label: "Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 },
        { id: "pic", type: "image", label: "Picture", phase: "gathering", backgroundTheme: "light", durationSec: 10 },
        { id: "inter", type: "interstitial", label: "Interstitial", phase: "post", backgroundTheme: "light", durationSec: 10 }
      ],
      manualSlides: {
        "hymn-1": { text: "Holy God", notes: "music", textVAlign: "top", imageUrl: null },
        pic: { text: "", notes: "", imageUrl: "/api/mass-asset/pic.jpg" },
        inter: { text: "", notes: "", imageUrl: "/api/mass-asset/inter.jpg" }
      },
      readingsSource: {
        documents: [{ stem: "Reading_I", passage: "Is 1:1", textLines: ["A reading."] }]
      }
    };
  }

  test("a serialized full document passes validation", () => {
    const document = buildMassDocumentFromState(fullState());
    expect(() => validateMassDocument(document)).not.toThrow();
    expect(document.metadata.title).toBe("Round Trip");
  });

  test("a serialized document restores to runtime state with the same ids", () => {
    const document = buildMassDocumentFromState(fullState());
    const runtime = buildRuntimeStateFromMassDocument(JSON.parse(JSON.stringify(document)));
    expect(runtime.organizerSequence.map((item) => item.id)).toEqual(["pre-count", "reading-1", "hymn-1", "pic", "inter"]);
    expect(runtime.manualSlides.pic.imageUrl).toBe("/api/mass-asset/pic.jpg");
  });

  test("round trips global and group text bounds", () => {
    const state = fullState();
    state.screenSettings.textBounds = {
      readingBody: { left: 100, right: 120, top: 140, bottom: 160 },
      readingPassage: { left: 80, right: 1000, top: 50, bottom: 900 },
      hymn: { left: 150, right: 160, top: 170, bottom: 180 },
      prayer: { left: 190, right: 200, top: 210, bottom: 220 },
      text: { left: 230, right: 240, top: 250, bottom: 260 }
    };
    const reading = state.organizerSequence.find((item) => item.type === "reading");
    reading.styleOverrides = {
      bounds: {
        body: { left: 200, right: 220, top: 180, bottom: 160 },
        passage: { left: 300, right: 900, top: 60, bottom: 880 }
      }
    };
    const hymn = state.organizerSequence.find((item) => item.type === "hymn");
    state.manualSlides[hymn.id].styleOverrides = {
      bounds: { body: { left: 240, right: 260, top: 200, bottom: 180 } }
    };

    const document = JSON.parse(JSON.stringify(buildMassDocumentFromState(state)));
    expect(() => validateMassDocument(document)).not.toThrow();
    const runtime = buildRuntimeStateFromMassDocument(document);

    expect(runtime.screenSettings.textBounds).toEqual(state.screenSettings.textBounds);
    expect(runtime.organizerSequence.find((item) => item.id === reading.id).styleOverrides.bounds)
      .toEqual(reading.styleOverrides.bounds);
    expect(runtime.manualSlides[hymn.id].styleOverrides.bounds)
      .toEqual(state.manualSlides[hymn.id].styleOverrides.bounds);
  });

  test("maps legacy background aliases to the dark and light fields and back", () => {
    const state = fullState();
    state.screenSettings = {
      colorBackgroundUrl: "/api/mass-asset/color.jpg",
      imageBackgroundUrl: "/static/uploads/image.jpg"
    };
    const document = buildMassDocumentFromState(state);
    expect(document.presentationDefaults.darkBackgroundUrl).toBe("assets/color.jpg");
    expect(document.presentationDefaults.lightBackgroundUrl).toBe("assets/image.jpg");
    expect(document.presentationDefaults.colorBackgroundUrl).toBeUndefined();
    expect(document.assets).toHaveProperty(["assets/color.jpg"]);

    const legacyDocument = JSON.parse(JSON.stringify(document));
    legacyDocument.presentationDefaults = {
      colorBackgroundUrl: "assets/color.jpg",
      imageBackgroundUrl: "assets/image.jpg"
    };
    const runtime = buildRuntimeStateFromMassDocument(legacyDocument);
    expect(runtime.screenSettings.darkBackgroundUrl).toBe("/api/mass-asset/color.jpg");
    expect(runtime.screenSettings.lightBackgroundUrl).toBe("/api/mass-asset/image.jpg");
  });

  test("round trips psalm refrain index, countdown style, and video auto advance", () => {
    const state = fullState();
    state.organizerSequence.push(
      { id: "psalm", type: "reading", label: "Psalm", phase: "mass", backgroundTheme: "dark", sourceStem: "Psalm", psalmRefrainIndex: 2.7, durationSec: 10 },
      { id: "count", type: "countdown", label: "Count", phase: "pre", backgroundTheme: "dark", durationSec: 60 },
      { id: "vid", type: "movie", label: "Video", phase: "gathering", backgroundTheme: "light", durationSec: 10 }
    );
    state.manualSlides.count = { text: "", notes: "", countdownFont: "Lora", countdownStyle: "bar" };
    state.manualSlides.vid = { text: "Caption", notes: "", imageUrl: "/api/mass-asset/v.mp4", videoAutoAdvance: false };
    const document = JSON.parse(JSON.stringify(buildMassDocumentFromState(state)));
    expect(() => validateMassDocument(document)).not.toThrow();
    const byId = Object.fromEntries(document.items.map((item) => [item.id, item]));
    expect(byId.psalm.presentation.psalmRefrainIndex).toBe(2);
    expect(byId.count.presentation.countdownStyle).toBe("bar");
    expect(byId.count.presentation.fontFamily).toBe("Lora");
    expect(byId.vid.content.autoAdvance).toBe(false);

    const runtime = buildRuntimeStateFromMassDocument(document);
    const psalm = runtime.organizerSequence.find((item) => item.id === "psalm");
    expect(psalm.psalmRefrainIndex).toBe(2);
    expect(runtime.manualSlides.vid.videoAutoAdvance).toBe(false);
  });

  test("builds a valid document from a legacy package", () => {
    const document = buildMassDocumentFromLegacyPackage(
      {
        presentationTitle: "Legacy",
        massStartTime: null,
        organizerSequence: [{ id: "h", type: "hymn", label: "Hymn", phase: "mass", backgroundTheme: "dark", durationSec: 10 }],
        manualCues: { h: { text: "Verse", notes: "", imageUrl: null } }
      },
      [],
      {}
    );
    expect(() => validateMassDocument(document)).not.toThrow();
    expect(document.metadata.title).toBe("Legacy");
  });

  test("builds a valid default document from an empty legacy package", () => {
    const document = buildMassDocumentFromLegacyPackage({});
    expect(document.metadata.title).toBe("Mass Presentation");
    expect(() => validateMassDocument(document)).not.toThrow();
  });
});

describe("assetUrlFromRef character checks", () => {
  test.each([
    'assets/a"><img src=x onerror=1>.png',
    "assets/a<b>.png",
    "assets/a`b.png",
    "assets/a\\b.png",
    "assets/a\u0001b.png"
  ])("rejects %j", (ref) => {
    expect(() => assetUrlFromRef(ref)).toThrow(ValidationError);
  });

  test("accepts a name with spaces, a percent sign, and an apostrophe", () => {
    expect(assetUrlFromRef("assets/Mary's 100% photo #1.png")).toBe("/api/mass-asset/Mary's%20100%25%20photo%20%231.png");
  });
});
