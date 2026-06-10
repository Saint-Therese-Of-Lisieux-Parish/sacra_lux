const {
  ValidationError,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  validateMassDocument
} = require("../../src/massDocument");

describe("massDocument", () => {
  test("serializes runtime state into a v3 Mass document", () => {
    const document = buildMassDocumentFromState({
      presentation: { title: "Easter Sunday" },
      massStartTime: "2026-04-12T10:30:00-04:00",
      screenSettings: {
        fontFamily: "Merriweather",
        darkBackgroundUrl: "/api/mass-asset/color-bg.jpg",
        lightBackgroundUrl: "/static/assets/background-graphic.png"
      },
      organizerSequence: [
        {
          id: "first-reading",
          type: "reading",
          label: "First Reading",
          phase: "mass",
          backgroundTheme: "dark",
          sourceStem: "Reading_I",
          styleOverrides: {
            fontFamily: "Lora",
            fontSizePx: 72,
            bold: true,
            italic: true,
            outline: true,
            shadow: false
          },
          durationSec: 10
        },
        {
          id: "opening-hymn",
          type: "hymn",
          label: "Opening Hymn",
          phase: "mass",
          backgroundTheme: "dark",
          durationSec: 10
        },
        {
          id: "transition",
          type: "interstitial",
          label: "Interstitial",
          phase: "mass",
          backgroundTheme: "light",
          durationSec: 10
        },
        {
          id: "welcome-video",
          type: "movie",
          label: "Welcome Video",
          phase: "gathering",
          backgroundTheme: "light",
          durationSec: 10
        }
      ],
      manualSlides: {
        "opening-hymn": {
          text: "Holy God\n---\nWe Praise Thy Name",
          notes: "music",
          textVAlign: "top",
          imageUrl: null,
          styleOverrides: {
            fontFamily: "Playfair Display",
            fontSizePx: 88,
            bold: true,
            italic: false,
            outline: true,
            shadow: true
          }
        },
        transition: {
          text: "",
          notes: "",
          imageUrl: "/api/mass-asset/transition.jpg"
        },
        "welcome-video": {
          text: "Welcome video",
          notes: "start with audio",
          videoUrl: "/api/mass-asset/welcome.mp4",
          videoLoop: false,
          videoAutoAdvance: true
        }
      },
      readingsSource: {
        documents: [
          {
            stem: "Reading_I",
            section: "Reading I",
            passage: "Genesis 1:1-3",
            textLines: ["In the beginning..."],
            ending: null
          }
        ]
      }
    });

    expect(document.format).toBe("sacra-lux.mass");
    expect(document.version).toBe(3);
    expect(document.metadata.title).toBe("Easter Sunday");
    expect(document.metadata.scheduledStart).toBe("2026-04-12T10:30:00-04:00");
    expect(document.items).toHaveLength(4);
    expect(document.items[0]).toMatchObject({
      kind: "reading",
      section: "mass",
      source: {
        stem: "Reading_I",
        citation: "Genesis 1:1-3"
      },
      content: {
        text: "In the beginning..."
      },
      presentation: {
        background: "dark",
        fontFamily: "Lora",
        fontSizePx: 72,
        bold: true,
        italic: true,
        outline: true,
        shadow: false
      }
    });
    expect(document.items[1]).toMatchObject({
      kind: "hymn",
      content: {
        text: "Holy God\n---\nWe Praise Thy Name"
      },
      notes: "music",
      presentation: {
        background: "dark",
        textVAlign: "top",
        fontFamily: "Playfair Display",
        fontSizePx: 88,
        bold: true,
        italic: false,
        outline: true,
        shadow: true
      }
    });
    expect(document.items[2]).toMatchObject({
      kind: "interstitial",
      asset: {
        ref: "assets/transition.jpg"
      }
    });
    expect(document.items[3]).toMatchObject({
      kind: "movie",
      notes: "start with audio",
      asset: {
        ref: "assets/welcome.mp4"
      },
      content: {
        text: "Welcome video"
      },
      presentation: {
        background: "light",
        loop: false
      }
    });
    expect(document.assets["assets/transition.jpg"]).toEqual({});
    expect(document.assets["assets/welcome.mp4"]).toEqual({});
    expect(document.assets["assets/color-bg.jpg"]).toEqual({});
  });

  test("builds runtime state from a v3 Mass document", () => {
    const runtime = buildRuntimeStateFromMassDocument({
      format: "sacra-lux.mass",
      version: 3,
      metadata: {
        title: "Palm Sunday",
        scheduledStart: "2026-04-05T09:00:00-04:00"
      },
      presentationDefaults: {
        fontFamily: "Merriweather",
        darkBackgroundUrl: "assets/background.jpg"
      },
      items: [
        {
          id: "reading-1",
          kind: "reading",
          label: "First Reading",
          section: "mass",
          content: {
            text: "In the beginning..."
          },
          source: {
            stem: "Reading_I",
            citation: "Genesis 1:1-3"
          },
          presentation: {
            background: "dark",
            fontFamily: "Cormorant Garamond",
            fontSizePx: 70,
            bold: false,
            italic: true,
            outline: true,
            shadow: false
          }
        },
        {
          id: "countdown-1",
          kind: "countdown",
          label: "Countdown",
          section: "gathering",
          content: {
            seconds: 30,
            showLabel: false
          },
          presentation: {
            background: "dark",
            fontFamily: "Lora",
            countdownSizePercent: 135
          }
        },
        {
          id: "welcome-video",
          kind: "movie",
          label: "Welcome Video",
          section: "gathering",
          notes: "fade audio at end",
          content: {
            text: "Welcome video",
            autoAdvance: true
          },
          asset: {
            ref: "assets/welcome.mp4"
          },
          presentation: {
            background: "light",
            loop: false
          }
        }
      ],
      assets: {
        "assets/background.jpg": {},
        "assets/welcome.mp4": {}
      }
    });

    expect(runtime.presentationTitle).toBe("Palm Sunday");
    expect(runtime.massStartTime).toBe("2026-04-05T09:00:00-04:00");
    expect(runtime.screenSettings.darkBackgroundUrl).toBe("/api/mass-asset/background.jpg");
    expect(runtime.organizerSequence).toEqual([
      {
        id: "reading-1",
        type: "reading",
        label: "First Reading",
        phase: "mass",
        backgroundTheme: "dark",
        durationSec: 10,
        sourceStem: "Reading_I",
        styleOverrides: {
          fontFamily: "Cormorant Garamond",
          fontSizePx: 70,
          bold: false,
          italic: true,
          outline: true,
          shadow: false
        }
      },
      {
        id: "countdown-1",
        type: "countdown",
        label: "Countdown",
        phase: "gathering",
        backgroundTheme: "dark",
        durationSec: 10
      },
      {
        id: "welcome-video",
        type: "movie",
        label: "Welcome Video",
        phase: "gathering",
        backgroundTheme: "light",
        durationSec: 10
      }
    ]);
    expect(runtime.documents).toEqual([
      {
        stem: "Reading_I",
        section: "First Reading",
        passage: "Genesis 1:1-3",
        textLines: ["In the beginning..."],
        ending: null
      }
    ]);
    expect(runtime.manualSlides["countdown-1"]).toMatchObject({
      countdownSec: 30,
      countdownFont: "Lora",
      countdownSizePercent: 135,
      styleOverrides: {}
    });
    expect(runtime.manualSlides["welcome-video"]).toMatchObject({
      notes: "fade audio at end",
      text: "Welcome video",
      videoUrl: "/api/mass-asset/welcome.mp4",
      videoLoop: false,
      videoAutoAdvance: true,
      styleOverrides: {}
    });
  });

  test("rejects duplicate item ids", () => {
    expect(() => validateMassDocument({
      format: "sacra-lux.mass",
      version: 3,
      metadata: {
        title: "Bad"
      },
      items: [
        {
          id: "dup",
          kind: "text",
          label: "One",
          section: "mass",
          content: { text: "A" }
        },
        {
          id: "dup",
          kind: "text",
          label: "Two",
          section: "mass",
          content: { text: "B" }
        }
      ]
    })).toThrow(ValidationError);
  });

  test("rejects invalid scheduledStart values", () => {
    expect(() => validateMassDocument({
      format: "sacra-lux.mass",
      version: 3,
      metadata: {
        title: "Bad Time",
        scheduledStart: "not-a-date"
      },
      items: []
    })).toThrow(/scheduledStart/i);
  });
});
