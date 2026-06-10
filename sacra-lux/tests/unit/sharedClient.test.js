const fs = require("fs");
const path = require("path");
const { escapeHtml, formatCountdownTime } = require("../../public/client/shared.js");

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
  });
});
