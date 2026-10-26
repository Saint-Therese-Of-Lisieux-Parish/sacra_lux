const fs = require("fs");
const path = require("path");
const {
  escapeHtml,
  formatCountdownTime,
  formatDurationTime,
  imageFileNameLabel,
  itemRuntimeSeconds,
  knownFontName,
  slideshowRuntimeSeconds,
  slideshowLabelFromFileNames
} = require("../../public/client/shared.js");

describe("shared client helpers", () => {
  describe("escapeHtml", () => {
    test("escapes markup-significant characters", () => {
      expect(escapeHtml('<b class="x">&\'</b>')).toBe(
        "&lt;b class=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;"
      );
    });

    test("escapes ampersand first so entities are not double-decoded", () => {
      expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });

    test("coerces non-string values", () => {
      expect(escapeHtml(42)).toBe("42");
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
    });

    test("leaves plain text untouched", () => {
      expect(escapeHtml("Tenth Sunday in Ordinary Time")).toBe(
        "Tenth Sunday in Ordinary Time"
      );
    });
  });

  describe("formatCountdownTime", () => {
    test("renders sub-minute values as bare seconds", () => {
      expect(formatCountdownTime(0)).toBe("0");
      expect(formatCountdownTime(59)).toBe("59");
    });

    test("renders minute values as m:ss", () => {
      expect(formatCountdownTime(60)).toBe("1:00");
      expect(formatCountdownTime(125)).toBe("2:05");
      expect(formatCountdownTime(3600)).toBe("60:00");
    });

    test("clamps negative and non-numeric input to zero", () => {
      expect(formatCountdownTime(-5)).toBe("0");
      expect(formatCountdownTime("abc")).toBe("0");
      expect(formatCountdownTime(undefined)).toBe("0");
    });
  });

  describe("formatDurationTime", () => {
    test("always renders slide durations as MM:SS", () => {
      expect(formatDurationTime(0)).toBe("00:00");
      expect(formatDurationTime(10)).toBe("00:10");
      expect(formatDurationTime(65)).toBe("01:05");
      expect(formatDurationTime(3665)).toBe("61:05");
    });

    test("rounds fractional seconds and clamps invalid input", () => {
      expect(formatDurationTime(10.6)).toBe("00:11");
      expect(formatDurationTime(-5)).toBe("00:00");
      expect(formatDurationTime("abc")).toBe("00:00");
    });
  });

  describe("itemRuntimeSeconds", () => {
    const images = [{ url: "/a.png" }, { url: "/b.png" }, { url: "/c.png" }, { url: "" }];
    const slideshow = { id: "s", type: "imageSlideshow", durationSec: 10 };

    test("slideshow time is images x seconds x loops, with no fade time", () => {
      const manual = { images, slideshowDurationSec: 10, slideshowLoopCount: 1 };
      expect(itemRuntimeSeconds(slideshow, manual, 3)).toBe(30);
      expect(itemRuntimeSeconds(slideshow, { ...manual, slideshowLoopCount: 2 }, 3)).toBe(60);
    });

    test("slideshow time ignores the transition setting and the editor preview agrees", () => {
      const manual = { images, slideshowDurationSec: 10, slideshowLoopCount: 2 };
      expect(itemRuntimeSeconds(slideshow, manual, 3)).toBe(slideshowRuntimeSeconds(3, 10, 2));
    });

    test("an explicit playable image count overrides the manual images", () => {
      const manual = { images, slideshowDurationSec: 5, slideshowLoopCount: 1 };
      expect(itemRuntimeSeconds(slideshow, manual, 3, 2)).toBe(10);
    });

    test("a multi-page item plays durationSec for each page", () => {
      expect(itemRuntimeSeconds({ type: "text", durationSec: 10 }, undefined, 3)).toBe(30);
    });

    test("a countdown uses its countdown seconds", () => {
      expect(itemRuntimeSeconds({ type: "countdown", durationSec: 10 }, { countdownSec: 45 }, 1)).toBe(45);
    });

    test("a movie has no known time", () => {
      expect(itemRuntimeSeconds({ type: "movie", durationSec: null }, {}, 1)).toBeNull();
    });

    test("phase total is the sum of the item times", () => {
      const items = [
        [slideshow, { images, slideshowDurationSec: 10, slideshowLoopCount: 1 }, 3],
        [{ type: "text", durationSec: 10 }, undefined, 3],
        [{ type: "countdown" }, { countdownSec: 45 }, 1]
      ];
      const total = items.reduce((sum, args) => sum + itemRuntimeSeconds(...args), 0);
      expect(total).toBe(30 + 30 + 45);
    });
  });

  describe("imageFileNameLabel", () => {
    test("strips the extension from a bare file name", () => {
      expect(imageFileNameLabel("Zulu.png")).toBe("Zulu");
    });

    test("takes the last path segment for a URL", () => {
      expect(imageFileNameLabel("/api/mass-asset/Easter%20Vigil.jpg")).toBe("Easter Vigil");
    });

    test("drops query strings and hashes", () => {
      expect(imageFileNameLabel("Photo 1.jpeg?cache=2")).toBe("Photo 1");
      expect(imageFileNameLabel("Photo 1.jpeg#top")).toBe("Photo 1");
    });

    test("decodes percent-encoded names and survives malformed escapes", () => {
      expect(imageFileNameLabel("Easter%20Vigil.jpg")).toBe("Easter Vigil");
      expect(imageFileNameLabel("100%.png")).toBe("100%");
    });

    test("returns an empty string for unusable input", () => {
      expect(imageFileNameLabel("")).toBe("");
      expect(imageFileNameLabel("   ")).toBe("");
      expect(imageFileNameLabel(null)).toBe("");
      expect(imageFileNameLabel(undefined)).toBe("");
    });
  });

  describe("slideshowLabelFromFileNames", () => {
    test("titles a multi-image drop from the first file in drop order", () => {
      expect(slideshowLabelFromFileNames(["Zulu.png", "Alpha.png"])).toBe("Zulu");
      expect(slideshowLabelFromFileNames(["Alpha.png", "Zulu.png"])).toBe("Alpha");
    });

    test("strips the extension and any directory from the first name", () => {
      expect(slideshowLabelFromFileNames(["folder/2 - Entrance.jpeg"])).toBe("2 - Entrance");
    });

    test("skips blank names in favor of the first usable one", () => {
      expect(slideshowLabelFromFileNames(["", "   ", "Alpha.png"])).toBe("Alpha");
    });

    test("falls back when no usable name is present", () => {
      expect(slideshowLabelFromFileNames([])).toBe("Image Slideshow");
      expect(slideshowLabelFromFileNames(["", "   "])).toBe("Image Slideshow");
      expect(slideshowLabelFromFileNames(undefined)).toBe("Image Slideshow");
    });

    test("honors a custom fallback", () => {
      expect(slideshowLabelFromFileNames([], "Slideshow")).toBe("Slideshow");
    });
  });

  describe("page wiring", () => {
    const pages = ["app.html", "screen.html", "remote.html"];

    test.each(pages)("%s loads shared.js before its inline script", (page) => {
      const html = fs.readFileSync(
        path.join(__dirname, "../../public", page),
        "utf8"
      );
      const sharedAt = html.indexOf('<script src="/static/client/shared.js">');
      const inlineAt = html.indexOf("<script>\n");
      expect(sharedAt).toBeGreaterThan(-1);
      expect(inlineAt).toBeGreaterThan(sharedAt);
    });

    test.each(pages)("%s defines no duplicate escape helper body", (page) => {
      const html = fs.readFileSync(
        path.join(__dirname, "../../public", page),
        "utf8"
      );
      expect(html).not.toMatch(/\.replace(All)?\((\/&\/g|"&")/);
    });

    test("app titles phase-drop slideshows through the shared label helper", () => {
      const html = fs.readFileSync(
        path.join(__dirname, "../../public/app.html"),
        "utf8"
      );
      expect(html).toContain("SacraLuxShared.slideshowLabelFromFileNames(");
      expect(html).not.toContain("labelFromImageUrl(images[0].name)");
    });
  });

  describe("knownFontName", () => {
    test("returns known font names unchanged", () => {
      expect(knownFontName("Merriweather")).toBe("Merriweather");
      expect(knownFontName("Source Sans 3")).toBe("Source Sans 3");
    });

    test("falls back for unknown or markup-bearing names", () => {
      expect(knownFontName("Comic Sans MS")).toBe("");
      expect(knownFontName('<img src=x onerror=alert(1)>')).toBe("");
      expect(knownFontName("Lora', serif")).toBe("");
    });

    test("honors a custom fallback", () => {
      expect(knownFontName("Unknown", "Merriweather")).toBe("Merriweather");
      expect(knownFontName(undefined, "Merriweather")).toBe("Merriweather");
    });
  });
});
