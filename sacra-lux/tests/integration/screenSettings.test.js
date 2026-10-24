const request = require("supertest");

const {
  createTempHome,
  startIsolatedServer
} = require("../helpers/testHarness");

describe("screen settings normalization", () => {
  let handle;
  let app;
  let state;

  const fullInput = {
    colorBackgroundUrl: "/static/dark.png",
    graphicBackgroundUrl: "/static/light.png",
    fontFamily: "Lora",
    fontSizePx: 72,
    boldText: true,
    resolution: "4k",
    transition: "none",
    readingTextAlign: "right",
    readingTextVAlign: "bottom",
    readingTextFont: "Lora",
    readingTextSizePx: 50,
    readingTextBold: true,
    readingTextColor: "#112233",
    readingPassagePosition: "bottom",
    readingPassageAlign: "left",
    readingPassageFont: "Lora",
    readingPassageSizePx: 30,
    readingPassageBold: false,
    readingPassageColor: "#445566",
    readingPassageOutline: true,
    readingPassageOutlineColor: "#778899",
    readingPassageOutlineWidthPx: 3.14,
    readingSectionOutline: true,
    readingSectionOutlineColor: "#aabbcc",
    readingSectionOutlineWidthPx: 2,
    readingShowPageNumber: false,
    readingShowLabel: false,
    readingShowEnding: false,
    readingTextMarginXPx: 100,
    readingTextMarginYPx: 150,
    readingTextHeightPx: 700,
    readingPassageYPx: 80,
    readingPassageWidthPx: 700,
    readingLineHeight: 1.75,
    readingLetterSpacingPx: 1.5,
    readingTextItalic: true,
    readingTextOutline: true,
    readingTextOutlineColor: "#010203",
    readingTextOutlineWidthPx: 4,
    readingTextShadow: false,
    textSlideTextAlign: "left",
    textSlideTextVAlign: "top",
    textSlideTextFont: "Lora",
    textSlideTextSizePx: 64,
    textSlideTextBold: true,
    textSlideTextItalic: true,
    textSlideTextColor: "#040506",
    textSlideLineHeight: 1.8,
    textSlideLetterSpacingPx: 2,
    textSlideTextOutline: true,
    textSlideTextOutlineColor: "#070809",
    textSlideTextOutlineWidthPx: 5,
    textSlideTextShadow: false,
    textSlideShowPageNumber: false,
    textSlideMarginXPx: 120,
    textSlideMarginYPx: 100,
    textSlideTextHeightPx: 800
  };

  async function post(body) {
    const response = await request(app).post("/api/screen-settings").send(body).expect(200);
    return response.body.screenSettings;
  }

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-screen-") });
    app = handle.app;
    ({ state } = require("../../src/state"));
  });

  afterAll(async () => {
    if (handle) await handle.stop();
  });

  test("accepts every valid field and keeps the values", async () => {
    const settings = await post(fullInput);

    expect(settings).toMatchObject({
      darkBackgroundUrl: "/static/dark.png",
      lightBackgroundUrl: "/static/light.png",
      fontFamily: "Lora",
      fontSizePx: 72,
      resolution: "4k",
      transition: "none",
      readingTextAlign: "right",
      readingTextVAlign: "bottom",
      readingTextColor: "#112233",
      readingPassageOutlineWidthPx: 3.1,
      readingLineHeight: 1.75,
      textSlideTextAlign: "left",
      textSlideTextVAlign: "top",
      textSlideTextFont: "Lora",
      textSlideTextColor: "#040506",
      textSlideTextHeightPx: 800
    });
    expect(settings.readingShowEnding).toBe(false);
    expect(settings.readingTextShadow).toBe(false);
  });

  test("keeps the previous values when the next request is empty", async () => {
    const before = await post(fullInput);
    const after = await post({});

    expect(after).toEqual(before);
  });

  test("replaces invalid values with defaults or clamps them", async () => {
    state.screenSettings = {};
    const settings = await post({
      fontFamily: "Not A Font",
      readingTextAlign: "justify",
      readingTextVAlign: "sideways",
      readingTextFont: "Not A Font",
      readingPassageFont: "Not A Font",
      readingPassagePosition: "middle",
      readingPassageAlign: "justify",
      resolution: "8k",
      transition: "spin",
      textSlideTextAlign: "justify",
      textSlideTextVAlign: "sideways",
      textSlideTextFont: "Not A Font",
      readingTextColor: "red",
      fontSizePx: 9999,
      readingPassageSizePx: 1,
      readingLineHeight: 99,
      readingLetterSpacingPx: -50,
      readingTextSizePx: 9999
    });

    expect(settings).toMatchObject({
      fontFamily: "Merriweather",
      readingTextAlign: "left",
      readingTextVAlign: "middle",
      readingTextFont: "",
      readingPassageFont: "Source Sans 3",
      readingPassagePosition: "top",
      readingPassageAlign: "center",
      resolution: "1080p",
      transition: "fade",
      textSlideTextAlign: "center",
      textSlideTextVAlign: "middle",
      textSlideTextFont: "",
      readingTextColor: "#f8f8f8",
      fontSizePx: 200,
      readingPassageSizePx: 20,
      readingLineHeight: 3,
      readingLetterSpacingPx: -2,
      readingTextSizePx: 200
    });
    expect(settings.darkBackgroundUrl).toBe("/static/assets/default-text-background.avif");
    expect(settings.lightBackgroundUrl).toBe("/static/assets/default-interstitial.png");
  });

  test("falls back to stored values when the request leaves fields out", async () => {
    state.screenSettings = { ...fullInput, darkBackgroundUrl: "/static/stored.png", lightBackgroundUrl: "/static/stored-light.png" };
    const settings = await post({ readingTextColor: "bad" });

    expect(settings.darkBackgroundUrl).toBe("/static/stored.png");
    expect(settings.lightBackgroundUrl).toBe("/static/stored-light.png");
    expect(settings.fontFamily).toBe("Lora");
    expect(settings.readingTextColor).toBe("#112233");
    expect(settings.readingTextAlign).toBe("right");
    expect(settings.textSlideMarginXPx).toBe(120);
  });
});
