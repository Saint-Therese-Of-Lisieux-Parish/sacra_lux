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

  test("announcement sections import media by drag and drop without picker buttons", () => {
    expect(appHtml).toContain('data-folder-import-phase="${item.phase}"');
    expect(appHtml).toContain("function droppedImageFolder(dataTransfer)");
    expect(appHtml).toContain("function importSingleMedia");
    expect(appHtml).toContain("function importImageFiles");
    expect(appHtml).not.toContain("phase-folder-import-btn");
    expect(appHtml).not.toContain("phaseFolderImportFiles");
  });

  test("slide editor shows Slide Basics before the preview and type panels", () => {
    const basics = appHtml.indexOf('<div class="modal-panel-title">Slide Basics</div>');
    expect(basics).toBeGreaterThan(-1);
    expect(basics).toBeLessThan(appHtml.indexOf('id="editorPreviewSection"'));
    expect(basics).toBeLessThan(appHtml.indexOf('id="editorSectionReading"'));
    for (const id of ["editorLabel", "editorType", "editorPhase", "editorBackgroundTheme"]) {
      expect(appHtml.indexOf(`id="${id}"`)).toBeGreaterThan(basics);
    }
  });

  test("editor focus trap uses visible controls only", () => {
    expect(appHtml).toContain("function getVisibleFocusableElements(container)");
    expect(appHtml).toContain("const focusable = getVisibleFocusableElements(els.editorDialog);");
  });

  test("reading ending setting is wired in the operator and screen clients", () => {
    const screenHtml = fs.readFileSync(path.join(__dirname, "../../public/screen.html"), "utf8");

    expect(appHtml).toContain('id="readingShowEnding"');
    expect(appHtml).toContain("readingShowEnding: Boolean(els.readingShowEnding.checked)");
    expect(screenHtml).toContain("settings.readingShowEnding !== false");
    expect(screenHtml).toContain("groupSettings.readingShowEnding !== false");
  });

  test("text bounds editors expose global and group controls", () => {
    expect(appHtml).toContain('id="textBoundsLayout"');
    expect(appHtml).toContain('id="textBoundsBox"');
    expect(appHtml).toContain('id="editorBoundsPanel"');
    expect(appHtml).toContain('id="editorBoundsUseGlobal"');
    expect(appHtml).toContain("Behold, I will make those of the assembly of Satan");
    expect(appHtml).toContain("Revelation 3:9");
    expect(appHtml).toContain('data-handle="nw"');
    expect(appHtml).toContain('data-handle="se"');
  });

  test("text bounds editors draw the handles over the projector renderer", () => {
    const screenHtml = fs.readFileSync(path.join(__dirname, "../../public/screen.html"), "utf8");

    for (const id of ["textBoundsPreview", "editorBoundsPreview"]) {
      const previewStart = appHtml.indexOf(`id="${id}"`);
      expect(previewStart).toBeGreaterThan(-1);
      const preview = appHtml.slice(previewStart, appHtml.indexOf("</div>", appHtml.indexOf("text-bounds-box", previewStart)));
      expect(preview).toContain(`<iframe class="text-bounds-preview-frame" id="${id}Frame" src="/screen?preview=1"`);
      expect(preview).not.toContain("text-bounds-preview-content");
    }
    expect(appHtml).not.toContain('id="textBoundsPreviewContent"');
    expect(appHtml).not.toContain('id="editorBoundsPreviewContent"');
    expect(appHtml).toContain('id="textBoundsPreviewError" role="alert"');
    expect(appHtml).toContain('id="editorBoundsPreviewError" role="alert"');
    expect(screenHtml).toContain('postMessage({ type: "preview_ready" }, window.location.origin)');
  });
});
