const fs = require("fs");
const path = require("path");

describe("public client markup guards", () => {
  const appHtml = fs.readFileSync(path.join(__dirname, "../../public/app.html"), "utf8");

  test("app html uses safe helpers for dynamic select population", () => {
    expect(appHtml).toContain("function replaceSelectOptions");
    expect(appHtml).toContain("replaceSelectOptions(\n        els.editorSourceStem,");
    expect(appHtml).toContain("replaceSelectOptions(els.editorAssetPicker, assetOptions");
    expect(appHtml).toContain("replaceSelectOptions(\n            els.editorPrayerSelect,");

    expect(appHtml).not.toMatch(/editorSourceStem\.innerHTML\s*=\s*documents/);
    expect(appHtml).not.toMatch(/editorAssetPicker\.innerHTML\s*=/);
    expect(appHtml).not.toMatch(/editorPrayerSelect\.innerHTML\s*=/);
  });

  test("app html escapes organizer strings before injecting sequence markup", () => {
    expect(appHtml).toContain("const safeItemId = escapeHtml(item.id);");
    expect(appHtml).toContain("const safeTitle = escapeHtml(item.label);");
    expect(appHtml).toContain("const safeSourceMeta = escapeHtml(sourceMeta);");
    expect(appHtml).toContain('data-item-id="${safeItemId}"');
    expect(appHtml).toContain('${index + 1}. ${safeTitle}');
    expect(appHtml).toContain('${pageCount} slide${pageCount === 1 ? "" : "s"}${safeSourceMeta}');
  });

  test("editor focus trap uses visible controls only", () => {
    expect(appHtml).toContain("function getVisibleFocusableElements(container)");
    expect(appHtml).toContain("const focusable = getVisibleFocusableElements(els.editorDialog);");
  });
});
