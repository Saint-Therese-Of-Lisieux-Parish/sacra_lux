const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const sharp = require("sharp");
const { clearRateLimitState } = require("../../src/security");

const {
  createTempHome,
  loadReadingsFolderOverHttp,
  makeReadingsFolder,
  startIsolatedServer
} = require("../helpers/testHarness");

// The slide type tab that selects each bounds layout.
const SETTINGS_TAB_FOR_LAYOUT = {
  readingBody: "reading-body",
  readingPassage: "reading-ref",
  hymn: "hymn",
  prayer: "prayer",
  text: "text"
};

let handle;
let baseUrl;
let readingsPath;

test.beforeAll(async () => {
  const homeDir = createTempHome("sacra-lux-e2e-");
  readingsPath = makeReadingsFolder(homeDir);
  handle = await startIsolatedServer({ port: 0, homeDir });
  baseUrl = handle.baseUrl;
});

test.beforeEach(() => {
  clearRateLimitState();
});

test.afterAll(async () => {
  if (handle) {
    await handle.stop();
  }
});

async function dismissRemoteSplash(page) {
  await expect(page.locator("#remoteSplash")).toBeVisible();
  await page.locator("#remoteSplash").click();
  await expect(page.locator("#remoteSplash")).toBeHidden();
}

test("App Settings lists Catholic themes first", async ({ page }) => {
  await page.goto(`${baseUrl}/`);
  await expect(page.locator("#massLibraryDialog")).toBeVisible();
  await page.locator("#massLibraryCloseBtn").click();
  await page.locator("#openAppSettingsBtn").click();
  await expect(page.locator("#appSettingsDialog")).toBeVisible();
  await expect(page.locator("#themePicker .theme-swatch")).toHaveCount(22);

  await expect(page.locator("#themePicker .theme-swatch")).toHaveText([
    "Carmel Light",
    "Carmel Dark",
    "Advent",
    "Lenten",
    "Easter",
    "Marian",
    "Sacred Heart",
    "San Juan",
    "Jesuit",
    "Dominican",
    "Franciscan",
    "Benedictine",
    "Light",
    "Dark",
    "Rose",
    "Solarized",
    "Ocean",
    "High Contrast",
    "Nord",
    "Monokai",
    "Stained Glass",
    "Geaux Tigers"
  ]);
});

test("Interstitial editor shows the built-in default image and offers it first in the asset list", async ({ page, request }) => {
  const organizerRes = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "interstitial:default", type: "interstitial", label: "Interstitial", phase: "mass", backgroundTheme: "light" }
      ],
      manualSlides: {
        "interstitial:default": { text: "", notes: "", imageUrl: null }
      }
    }
  });
  expect(organizerRes.ok()).toBeTruthy();

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="interstitial:default"]').click();

  // R1: the preview shows the default image, not a broken image icon.
  const preview = page.locator("#imagePreview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/static\/assets\/default-interstitial\.png$/);
  await expect.poll(() => preview.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

  // R2: the built-in default is the first entry after the placeholder.
  const options = page.locator("#editorAssetPicker option");
  await expect(options.nth(1)).toHaveText("Default (built-in)");
  await expect(options.nth(1)).toHaveAttribute("value", "/static/assets/default-interstitial.png");

  // R3: selecting the default sets the Interstitial image to the default image.
  await page.locator("#editorAssetPicker").selectOption("/static/assets/default-interstitial.png");
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["interstitial:default"]?.imageUrl;
  }).toBe("/static/assets/default-interstitial.png");
  await expect(preview).toHaveAttribute("src", /default-interstitial\.png$/);
});

test("Screen Settings Apply Changes & Close saves the settings and closes the dialog", async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();
  const applyButton = page.getByRole("button", { name: "Apply Changes & Close" });
  await expect(applyButton).toBeVisible();

  await page.locator("#fontSizePx").fill("64");
  await applyButton.click();
  await expect(page.locator("#settingsDialog")).not.toBeVisible();
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.screenSettings.fontSizePx;
  }).toBe(64);
});

test("Screen Settings edits global text bounds with pointer and keyboard controls", async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();
  await expect(page.locator("#textBoundsSettings")).toBeVisible();
  await page.getByRole("tab", { name: "Window Position" }).click();
  await expect(page.frameLocator("#textBoundsPreviewFrame").locator("#stage"))
    .toContainText(/Behold, I will make those of the assembly of Satan/);

  for (const layout of ["readingBody", "readingPassage", "hymn", "prayer", "text"]) {
    await page.locator(`[data-settings-tab="${SETTINGS_TAB_FOR_LAYOUT[layout]}"]`).click();
    await expect(page.locator("#textBoundsBox")).toBeVisible();
    for (const edge of ["Left", "Right", "Top", "Bottom"]) {
      await expect(page.locator(`#textBounds${edge}`)).toBeVisible();
    }
  }

  await page.locator('[data-settings-tab="reading-body"]').click();
  await page.locator("#textBoundsLeft").fill("240");
  await page.locator("#textBoundsLeft").press("Tab");
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.screenSettings.textBounds?.readingBody?.left;
  }).toBe(240);

  const box = page.locator("#textBoundsBox");
  const initialLeft = Number(await page.locator("#textBoundsLeft").inputValue());
  await box.scrollIntoViewIfNeeded();
  const boundsBox = await box.boundingBox();
  await page.mouse.move(boundsBox.x + boundsBox.width / 2, boundsBox.y + boundsBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(boundsBox.x + boundsBox.width / 2 + 20, boundsBox.y + boundsBox.height / 2 + 10, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator("#textBoundsLeft").inputValue())).toBeGreaterThan(initialLeft);

  const handleMoves = {
    nw: [3, 3], n: [0, 3], ne: [-3, 3], e: [-3, 0],
    se: [-3, -3], s: [0, -3], sw: [3, -3], w: [3, 0]
  };
  for (const [handle, [dx, dy]] of Object.entries(handleMoves)) {
    const locator = page.locator(`#textBoundsBox [data-handle="${handle}"]`);
    await locator.scrollIntoViewIfNeeded();
    const before = await page.locator("#textBoundsLeft").inputValue() + ":" +
      await page.locator("#textBoundsRight").inputValue() + ":" +
      await page.locator("#textBoundsTop").inputValue() + ":" +
      await page.locator("#textBoundsBottom").inputValue();
    const handleBox = await locator.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + dx, handleBox.y + handleBox.height / 2 + dy, { steps: 3 });
    await page.mouse.up();
    const after = await page.locator("#textBoundsLeft").inputValue() + ":" +
      await page.locator("#textBoundsRight").inputValue() + ":" +
      await page.locator("#textBoundsTop").inputValue() + ":" +
      await page.locator("#textBoundsBottom").inputValue();
    expect(after).not.toBe(before);
  }

  await box.focus();
  const keyboardLeft = Number(await page.locator("#textBoundsLeft").inputValue());
  await box.press("Shift+ArrowRight");
  await expect(page.locator("#textBoundsLeft")).toHaveValue(String(keyboardLeft + 10));
  await expect(box).toBeFocused();

  await page.locator("#textBoundsReset").click();
  await expect(page.locator("#textBoundsLeft")).toHaveValue("80");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#textBoundsPreview")).toBeVisible();
  await expect(page.locator("#textBoundsBox")).toBeVisible();
});

test("Screen Settings fits the tabs and preview at the minimum window size", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();
  const box = async (selector) => page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  const body = await box("#settingsDialog .settings-dialog-body");
  const inBody = (rect) => rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;

  for (const tab of ["Font", "Window Position"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    expect(inBody(await box('[aria-label="Slide type"]'))).toBe(true);
    const preview = await box("#textBoundsPreview");
    expect(inBody(preview)).toBe(true);
    expect(preview.bottom - preview.top).toBeLessThanOrEqual(200);
    expect(inBody(await box('[aria-label="Control panel"]'))).toBe(true);
  }

  // The tabs and the preview stay in view while the control pane scrolls.
  await page.getByRole("tab", { name: "Font", exact: true }).click();
  await page.locator("#readingTextOutlineWidthPx").scrollIntoViewIfNeeded();
  expect(inBody(await box("#textBoundsPreview"))).toBe(true);
  expect(inBody(await box('[aria-label="Control panel"]'))).toBe(true);
});

async function openTextAreaTool(page) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();
  await expect(page.locator("#textBoundsSettings")).toBeVisible();
  await page.getByRole("tab", { name: "Window Position" }).click();
}

// Read the reading body bounds that the projector renderer applied inside a preview frame.
async function previewReadingLeft(page, frameId) {
  return page.frameLocator(`#${frameId}`).locator("#stage").evaluate((stage) =>
    parseFloat(getComputedStyle(stage).getPropertyValue("--reading-text-left")));
}

test("Text Area tool draws its handles over the projector renderer", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/screen-settings`, { data: { resolution: "1080p" } });
  await openTextAreaTool(page);

  const frame = page.locator("#textBoundsPreviewFrame");
  await expect(frame).toHaveAttribute("src", "/screen?preview=1");
  const stage = page.frameLocator("#textBoundsPreviewFrame").locator("#stage");
  await expect(stage).toContainText("Revelation 3:9");
  await expect(stage).toContainText(/Behold, I will make those of the assembly of Satan/);
  await expect(page.locator("#textBoundsPreviewError")).toBeHidden();

  // The handles sit over the same area as the preview frame.
  await frame.scrollIntoViewIfNeeded();
  const frameBox = await page.locator("#textBoundsPreview").boundingBox();
  const boundsBox = await page.locator("#textBoundsBox").boundingBox();
  expect(boundsBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(boundsBox.x + boundsBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 1);

  // A number field change shows in the real preview within 100 ms.
  await page.locator('[data-settings-tab="reading-body"]').click();
  const startLeft = Number(await page.locator("#textBoundsLeft").inputValue());
  await expect.poll(() => previewReadingLeft(page, "textBoundsPreviewFrame")).toBe(startLeft);
  const elapsed = await page.evaluate(async () => {
    const input = document.getElementById("textBoundsLeft");
    const previewStage = document.getElementById("textBoundsPreviewFrame").contentDocument.getElementById("stage");
    const start = performance.now();
    input.value = "300";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    while (performance.now() - start < 1000) {
      if (parseFloat(getComputedStyle(previewStage).getPropertyValue("--reading-text-left")) === 300) {
        return performance.now() - start;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return Number.POSITIVE_INFINITY;
  });
  expect(elapsed).toBeLessThan(100);

  // A handle drag moves the number fields and the real preview together.
  const handle = page.locator('#textBoundsBox [data-handle="w"]');
  const handleBox = await handle.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 30, handleBox.y + handleBox.height / 2, { steps: 4 });
  await page.mouse.up();
  const draggedLeft = Number(await page.locator("#textBoundsLeft").inputValue());
  expect(draggedLeft).toBeGreaterThan(300);
  await expect.poll(() => previewReadingLeft(page, "textBoundsPreviewFrame")).toBe(draggedLeft);

  await page.locator("#textBoundsReset").click();
  await expect(page.locator("#textBoundsLeft")).toHaveValue("80");
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.screenSettings.textBounds?.readingBody?.left;
  }).toBe(80);
});

test("Text Area tool shows the group text and the projector page breaks", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/screen-settings`, { data: { resolution: "1080p" } });
  const longReadingPath = path.join(path.dirname(readingsPath), "long-readings");
  fs.mkdirSync(longReadingPath, { recursive: true });
  const verses = Array.from({ length: 14 }, (_, index) =>
    `Verse ${index + 1}: They devoted themselves to the teaching of the apostles and to the breaking of the bread.`);
  fs.writeFileSync(path.join(longReadingPath, "Reading_I.txt"), `Acts of the Apostles 2:42-47\n\n${verses.join("\n")}`, "utf8");
  const previousTitle = (await (await request.get(`${baseUrl}/api/state`)).json()).presentation?.title || "";
  await loadReadingsFolderOverHttp(request, baseUrl, longReadingPath);

  const initial = await (await request.get(`${baseUrl}/api/state`)).json();
  const item = initial.organizerSequence.find((entry) => entry.sourceStem === "Reading_I");
  expect(item).toBeTruthy();

  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator(`[data-edit-id="${item.id}"]`).click();
  await expect(page.locator("#editorBoundsPanel")).toBeVisible();
  const stage = page.frameLocator("#editorPreviewFrame").locator("#stage");
  await expect(stage).toContainText("Acts of the Apostles 2:42-47");
  await expect(stage).toContainText("Verse 1:");

  // Make the body box small so the text needs more than one page.
  for (const [edge, value] of [["Left", "700"], ["Right", "700"], ["Top", "380"], ["Bottom", "380"]]) {
    await page.locator(`#editorBounds${edge}`).fill(value);
  }
  await page.locator("#editorBoundsBottom").press("Tab");
  await expect.poll(() => previewReadingLeft(page, "editorPreviewFrame")).toBe(700);

  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.organizerSequence.find((entry) => entry.id === item.id)?.styleOverrides?.bounds?.body?.left;
  }).toBe(700);
  const saved = await (await request.get(`${baseUrl}/api/state`)).json();
  const projectorPages = saved.presentation.slides.filter((slide) => slide.organizerItemId === item.id);
  expect(projectorPages.length).toBeGreaterThan(1);
  await expect(page.locator("#editorPreviewStatus")).toHaveText(`1 / ${projectorPages.length}`);
  await expect(page.locator("#editorDialog iframe[src^='/screen?preview=1']")).toHaveCount(1);
  await expect(stage).toContainText(projectorPages[0].text.split("\n")[0]);

  await page.locator("#editorBoundsUseGlobal").click();
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.organizerSequence.find((entry) => entry.id === item.id)?.styleOverrides?.bounds;
  }).toBeUndefined();
  // Later tests expect the Mass title from before this test.
  await request.post(`${baseUrl}/api/update-title`, { data: { title: previousTitle } });
});

test("Text Area tool keeps the number fields usable when the preview fails", async ({ page, request }) => {
  await page.route((url) => url.pathname === "/screen" && url.searchParams.get("preview") === "1",
    (route) => route.abort());
  await page.route("**/api/preview-reading", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "Renderer failure" })
  }));
  await openTextAreaTool(page);

  await expect(page.locator("#textBoundsPreviewError")).toBeVisible();
  await expect(page.locator("#textBoundsPreviewError")).toContainText("The slide preview is not available");

  await page.locator('[data-settings-tab="reading-body"]').click();
  await page.locator("#textBoundsTop").fill("150");
  await page.locator("#textBoundsTop").press("Tab");
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.screenSettings.textBounds?.readingBody?.top;
  }).toBe(150);

  await page.locator("#textBoundsReset").click();
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.screenSettings.textBounds?.readingBody?.top;
  }).toBe(130);
});

test("slide groups save, copy, and remove text bounds overrides", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "text:bounds-e2e",
        type: "text",
        label: "Bounds test",
        phase: "mass",
        backgroundTheme: "dark"
      }],
      manualSlides: {
        "text:bounds-e2e": { text: "Current group content", styleOverrides: {} }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="text:bounds-e2e"]').click();
  await expect(page.locator("#editorBoundsPanel")).toBeVisible();
  await expect(page.frameLocator("#editorPreviewFrame").locator("#stage")).toContainText("Current group content");
  await expect(page.locator('#editorBoundsLayout option[value="passage"]')).toBeHidden();

  await page.locator("#editorBoundsLeft").fill("333");
  await page.locator("#editorBoundsLeft").press("Tab");
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["text:bounds-e2e"]?.styleOverrides?.bounds?.body?.left;
  }).toBe(333);

  await page.locator("#duplicateItemBtn").evaluate((button) => button.click());
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    const copy = state.organizerSequence.find((item) => item.id !== "text:bounds-e2e");
    return copy ? state.manualSlides[copy.id]?.styleOverrides?.bounds?.body?.left : null;
  }).toBe(333);

  await page.locator("#editorBoundsUseGlobal").click();
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    const copy = state.organizerSequence.find((item) => item.id !== "text:bounds-e2e");
    return copy ? state.manualSlides[copy.id]?.styleOverrides?.bounds : "missing";
  }).toBeUndefined();
});

test("projector keeps custom text bounds proportional at each resolution", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{ id: "text:projector-bounds", type: "text", label: "Bounds", phase: "mass", backgroundTheme: "dark" }],
      manualSlides: { "text:projector-bounds": { text: "Projector bounds" } }
    }
  });
  const expected = {
    "720p": [128, 256, 72, 144],
    "1080p": [192, 384, 108, 216],
    "1440p": [256, 512, 144, 288],
    "4k": [384, 768, 216, 432]
  };

  await page.goto(`${baseUrl}/screen`);
  for (const [resolution, values] of Object.entries(expected)) {
    await request.post(`${baseUrl}/api/screen-settings`, {
      data: {
        resolution,
        textBounds: {
          text: { left: 192, right: 384, top: 108, bottom: 216 }
        }
      }
    });
    await expect.poll(async () => page.locator("#stage").evaluate((stage) => {
      const style = getComputedStyle(stage);
      return [
        parseFloat(style.getPropertyValue("--text-slide-left")),
        parseFloat(style.getPropertyValue("--text-slide-right")),
        parseFloat(style.getPropertyValue("--text-slide-top")),
        parseFloat(style.getPropertyValue("--text-slide-bottom"))
      ];
    })).toEqual(values);
  }
});

const SCREEN_COLOR_FIELDS = {
  readingTextColor: "readingTextColor",
  readingTextOutlineColor: "readingTextOutlineColor",
  readingPassageColor: "readingPassageColor",
  readingPassageOutlineColor: "readingPassageOutlineColor",
  readingSectionOutlineColor: "readingSectionOutlineColor",
  textSlideTextColor: "textSlideTextColor",
  textSlideTextOutlineColor: "textSlideTextOutlineColor"
};

test("Screen Settings color fields pair each code with a visual picker", async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();

  const savedColor = async (key) => (await (await request.get(`${baseUrl}/api/state`)).json()).screenSettings[key];

  for (const id of Object.values(SCREEN_COLOR_FIELDS)) {
    const code = page.locator(`#${id}`);
    await expect(code).toHaveAttribute("type", "text");
    await expect(code).toHaveValue(/^#[0-9a-fA-F]{6}$/);
    const picker = page.locator(`.color-control:has(#${id}) input[type="color"]`);
    await expect(picker).toHaveCount(1);
    await expect(picker).toHaveValue((await code.inputValue()).toLowerCase());
  }

  // Picker -> code field -> saved state. Let the first state update settle first.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const picker = document.querySelector('.color-control:has(#readingTextColor) input[type="color"]');
    picker.value = "#336699";
    picker.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#readingTextColor")).toHaveValue("#336699");
  await expect.poll(() => savedColor("readingTextColor")).toBe("#336699");

  // Valid code -> picker. The text fields live in their own settings tab.
  await page.locator('[data-settings-tab="text"]').click();
  await page.locator("#textSlideTextColor").fill("#AA5500");
  await expect(page.locator('.color-control:has(#textSlideTextColor) input[type="color"]')).toHaveValue("#aa5500");
  await expect.poll(() => savedColor("textSlideTextColor")).toBe("#AA5500");

  // Invalid code keeps the last valid color. Let earlier state updates settle first.
  await page.waitForTimeout(500);
  await page.locator('[data-settings-tab="reading-ref"]').click();
  await page.locator("#readingPassageColor").fill("#12zz");
  await page.waitForTimeout(500);
  await expect(page.locator("#readingPassageColor")).toHaveAttribute("aria-invalid", "true");
  const passageBefore = await savedColor("readingPassageColor");
  await page.locator("#readingPassageColor").press("Tab");
  await expect(page.locator("#readingPassageColor")).toHaveValue(passageBefore);
  await expect(page.locator("#readingPassageColor")).not.toHaveAttribute("aria-invalid", "true");
  expect(await savedColor("readingPassageColor")).toBe(passageBefore);
});

test("reference and section title settings reach the screen and the controls", async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/screen`);
  await request.post(`${baseUrl}/api/screen-settings`, {
    data: {
      readingPassageItalic: true,
      readingPassageShadow: false,
      readingPassageLineHeight: 1.4,
      readingPassageLetterSpacingPx: 3,
      readingSectionFont: "Lora",
      readingSectionSizePx: 31,
      readingSectionColor: "#336699",
      readingSectionBold: false,
      readingSectionItalic: true,
      readingSectionShadow: false
    }
  });
  await expect.poll(async () => page.locator("#stage").evaluate((stage) => {
    const style = getComputedStyle(stage);
    return {
      italic: style.getPropertyValue("--reading-passage-style").trim(),
      shadow: style.getPropertyValue("--reading-passage-shadow").trim(),
      line: style.getPropertyValue("--reading-passage-line-height").trim(),
      spacing: style.getPropertyValue("--reading-passage-letter-spacing").trim(),
      sectionFont: style.getPropertyValue("--reading-section-font").trim(),
      sectionSize: style.getPropertyValue("--reading-section-size").trim(),
      sectionWeight: style.getPropertyValue("--reading-section-weight").trim(),
      sectionStyle: style.getPropertyValue("--reading-section-style").trim(),
      sectionShadow: style.getPropertyValue("--reading-section-shadow").trim()
    };
  })).toEqual({
    italic: "italic",
    shadow: "none",
    line: "1.4",
    spacing: "3px",
    sectionFont: '"Lora", sans-serif',
    sectionSize: "31px",
    sectionWeight: "400",
    sectionStyle: "italic",
    sectionShadow: "none"
  });

  // The Screen Settings controls show the saved values.
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();
  await page.locator('[data-settings-tab="reading-ref"]').click();
  await expect(page.locator("#readingPassageItalic")).toBeChecked();
  await expect(page.locator("#readingPassageShadow")).not.toBeChecked();
  await expect(page.locator("#readingPassageLineHeight")).toHaveValue("1.4");
  await expect(page.locator("#readingSectionFont")).toHaveValue("Lora");
  await expect(page.locator("#readingSectionSizePx")).toHaveValue("31");
  await expect(page.locator("#readingSectionColor")).toHaveValue("#336699");
  await expect(page.locator("#readingSectionBold")).not.toBeChecked();
  await expect(page.locator("#readingSectionItalic")).toBeChecked();

  // Changing a control saves it.
  await page.locator("label.fmt-toggle:has(#readingPassageShadow)").click();
  await expect.poll(async () => (await (await request.get(`${baseUrl}/api/state`)).json()).screenSettings.readingPassageShadow).toBe(true);
});

test("Screen Settings has no legacy position inputs and still saves bounds", async ({ page, request }) => {
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  const legacyIds = [
    "readingTextMarginXPx", "readingTextMarginYPx", "readingTextHeightPx", "readingPassageYPx",
    "readingPassageWidthPx", "textSlideMarginXPx", "textSlideMarginYPx", "textSlideTextHeightPx"
  ];
  for (const id of legacyIds) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }

  // The derived keys still follow the bounds.
  await request.post(`${baseUrl}/api/screen-settings`, {
    data: { resolution: "1080p", textBounds: { readingBody: { left: 111, right: 111, top: 99, bottom: 200 } } }
  });
  const settings = (await (await request.get(`${baseUrl}/api/state`)).json()).screenSettings;
  expect(settings.readingTextMarginXPx).toBe(111);
  expect(settings.readingTextMarginYPx).toBe(99);
  expect(settings.readingTextHeightPx).toBe(781);
});

test("Text, Hymn, and Prayer tabs keep separate font choices", async ({ page, request }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();

  const size = page.locator("#textSlideTextSizePx");
  await page.locator('[data-settings-tab="text"]').click();
  await size.fill("60");
  await page.locator('[data-settings-tab="hymn"]').click();
  await expect(size).toHaveValue("");
  await size.fill("70");
  await page.locator('[data-settings-tab="prayer"]').click();
  await expect(size).toHaveValue("");
  await page.locator("#textSlideTextItalic").check();
  await page.locator('[data-settings-tab="text"]').click();
  await expect(size).toHaveValue("60");
  await expect(page.locator("#textSlideTextItalic")).not.toBeChecked();

  await expect.poll(async () => {
    const saved = (await (await request.get(`${baseUrl}/api/state`)).json()).screenSettings;
    return [saved.textSlideTextSizePx, saved.hymnTextSizePx, saved.prayerTextSizePx, saved.prayerTextItalic, saved.hymnTextItalic];
  }).toEqual([60, 70, 0, true, false]);
});

test("Screen Settings shows one slide type text style at a time", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator("#openSettingsBtn").click();

  await expect(page.locator("#readingTextColor")).toBeVisible();
  await expect(page.locator("#readingPassageColor")).toBeHidden();
  await expect(page.locator("#textSlideTextColor")).toBeHidden();

  await page.locator('[data-settings-tab="reading-ref"]').click();
  await expect(page.locator("#readingPassageColor")).toBeVisible();
  await expect(page.locator("#readingTextColor")).toBeHidden();

  await page.locator('[data-settings-tab="text"]').click();
  await expect(page.locator("#textSlideTextColor")).toBeVisible();
  await expect(page.locator('[data-settings-tab="text"]')).toHaveAttribute("aria-selected", "true");

  // Inherited values show the real global font and size, not a generic label.
  const globalFont = await page.locator("#fontFamily").inputValue();
  const globalSize = await page.locator("#fontSizePx").inputValue();
  await expect(page.locator("#textSlideTextFont option").first()).toHaveText(`Default (${globalFont})`);
  await expect(page.locator("#textSlideTextSizePx")).toHaveAttribute("placeholder", globalSize);
});

test("Image Slideshow editor sorts batches and supports persistent ordering controls", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "imageSlideshow:e2e",
        type: "imageSlideshow",
        label: "Announcements",
        phase: "mass",
        backgroundTheme: "light",
        durationSec: 10
      }],
      manualSlides: {
        "imageSlideshow:e2e": {
          images: [],
          slideshowDurationSec: 10,
          slideshowLoopCount: 1
        }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="imageSlideshow:e2e"]').click();
  await expect(page.locator("#editorSectionImageSlideshow")).toBeVisible();

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=", "base64");
  await page.locator("#editorSlideshowFiles").setInputFiles([
    { name: "Zeta.png", mimeType: "image/png", buffer: png },
    { name: "Alpha.png", mimeType: "image/png", buffer: png }
  ]);

  const rows = page.locator("#slideshowImageList .slideshow-image-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);
  await expect(page.locator("#slideshowPreflightSummary")).toContainText("preflight warnings");

  await page.locator("#editorSlideshowDurationSec").fill("2");
  await page.locator("#editorSlideshowLoopCount").fill("2");
  await expect(page.locator("#slideshowRuntimePreview")).toHaveText("00:08");

  await page.locator("#reverseSlideshowBtn").click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Zeta.png", "2. Alpha.png"]);

  await rows.nth(1).getByRole("button", { name: /Move image up/ }).click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["imageSlideshow:e2e"]?.images?.map((image) => image.name);
  }).toEqual(["Alpha.png", "Zeta.png"]);

  await rows.nth(0).dragTo(rows.nth(1));
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Zeta.png", "2. Alpha.png"]);

  await page.locator("#sortSlideshowBtn").click();
  await expect(rows.locator(".slideshow-image-name")).toHaveText(["1. Alpha.png", "2. Zeta.png"]);

  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return state.manualSlides["imageSlideshow:e2e"]?.images?.map((image) => image.name);
  }).toEqual(["Alpha.png", "Zeta.png"]);
});

test("Dropping multiple images onto an image slide creates a titled slideshow", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "image:multi-drop",
        type: "image",
        label: "Image",
        phase: "mass",
        backgroundTheme: "light"
      }],
      manualSlides: {
        "image:multi-drop": { imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="image:multi-drop"]').click();
  await expect(page.locator("#editorSectionImage")).toBeVisible();

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=", "base64");
  await page.locator("#imagePreviewWrap").evaluate((element, encodedPng) => {
    const bytes = Uint8Array.from(atob(encodedPng), (character) => character.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], "Zulu.png", { type: "image/png" }));
    dataTransfer.items.add(new File([bytes], "Alpha.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, png.toString("base64"));

  await expect(page.locator("#editorSectionImageSlideshow")).toBeVisible();
  await expect(page.locator("#editorLabel")).toHaveValue("Zulu");
  await expect(page.locator("#slideshowImageList .slideshow-image-name")).toHaveText([
    "1. Zulu.png",
    "2. Alpha.png"
  ]);
  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    return {
      type: state.organizerSequence.find((item) => item.id === "image:multi-drop")?.type,
      label: state.organizerSequence.find((item) => item.id === "image:multi-drop")?.label,
      names: state.manualSlides["image:multi-drop"]?.images?.map((image) => image.name)
    };
  }).toEqual({ type: "imageSlideshow", label: "Zulu", names: ["Zulu.png", "Alpha.png"] });
});

test("Dropping multiple images onto a phase header creates a titled slideshow", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "text:pre-existing",
        type: "text",
        label: "Welcome",
        phase: "pre",
        backgroundTheme: "light",
        durationSec: 10
      }],
      manualSlides: {
        "text:pre-existing": { text: "Welcome" }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s2vNhcAAAAASUVORK5CYII=", "base64");
  await page.locator('[data-folder-import-phase="pre"]').evaluate((element, encodedPng) => {
    const bytes = Uint8Array.from(atob(encodedPng), (character) => character.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], "Zulu.png", { type: "image/png" }));
    dataTransfer.items.add(new File([bytes], "Alpha.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, png.toString("base64"));

  await expect.poll(async () => {
    const state = await (await request.get(`${baseUrl}/api/state`)).json();
    const slideshow = state.organizerSequence.find((item) => item.type === "imageSlideshow" && item.phase === "pre");
    return {
      label: slideshow?.label,
      names: slideshow ? state.manualSlides[slideshow.id]?.images?.map((image) => image.name) : null
    };
  }).toEqual({ label: "Zulu", names: ["Zulu.png", "Alpha.png"] });
});

test("Image Slideshow editor hides an unavailable preview image", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [{
        id: "imageSlideshow:missing-preview",
        type: "imageSlideshow",
        label: "Missing preview",
        phase: "mass",
        backgroundTheme: "light"
      }],
      manualSlides: {
        "imageSlideshow:missing-preview": {
          images: [{ url: "/api/mass-asset/does-not-exist.png", name: "Missing.png" }],
          slideshowDurationSec: 10,
          slideshowLoopCount: 1
        }
      }
    }
  });

  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }
  await page.locator('[data-edit-id="imageSlideshow:missing-preview"]').click();
  await expect(page.locator("#editorSectionImageSlideshow")).toBeVisible();
  await expect(page.locator("#slideshowPreview")).toBeHidden();
  await expect(page.locator("#slideshowPreviewEmpty")).toBeVisible();
});

test("Image Slideshow crossfades between consecutive images", async ({ page, request }) => {
  async function uploadPng(filename, background) {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background }
    }).png().toBuffer();
    const response = await request.post(`${baseUrl}/api/upload-mass-asset`, {
      data: {
        filename,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`
      }
    });
    expect(response.ok()).toBe(true);
    return response.json();
  }

  const first = await uploadPng("First.png", { r: 155, g: 28, b: 49 });
  const second = await uploadPng("Second.png", { r: 28, g: 79, b: 155 });
  await request.post(`${baseUrl}/api/screen-settings`, { data: { transition: "fade" } });
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        { id: "imageSlideshow:transition", type: "imageSlideshow", label: "Crossfade", phase: "mass", backgroundTheme: "light" },
        { id: "text:after-transition", type: "text", label: "After", phase: "mass", backgroundTheme: "dark" }
      ],
      manualSlides: {
        "imageSlideshow:transition": {
          images: [
            { url: first.url, name: "First.png" },
            { url: second.url, name: "Second.png" }
          ],
          slideshowDurationSec: 100,
          slideshowLoopCount: 1
        },
        "text:after-transition": { text: "After the slideshow" }
      }
    }
  });

  await page.goto(`${baseUrl}/screen`);
  await expect(page.locator(`.frame[data-image-url="${first.url}"]`)).toHaveCSS("opacity", "1");
  const stage = page.locator("#stage");
  // Advance the deck from a client socket. Keep the socket open until the
  // server has confirmed the advance: disconnecting immediately after emit()
  // can drop the buffered packet, so the Mass never moves and the crossfade
  // assertion flakes.
  await page.evaluate(async () => {
    const testSocket = io();
    await new Promise((resolve) => testSocket.on("connect", resolve));
    const advanced = new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      testSocket.on("state:update", (state) => {
        if (Number(state?.currentSlideIndex) >= 1) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    testSocket.emit("slide:next");
    await advanced;
    testSocket.disconnect();
  });
  await expect(stage).toHaveAttribute("data-slideshow-transitioning", "true", { timeout: 3500 });

  const transitionFrames = await page.locator(".frame").evaluateAll((frames) => frames.map((frame) => ({
    imageUrl: frame.dataset.imageUrl,
    opacity: frame.style.opacity
  })));
  expect(transitionFrames).toEqual(expect.arrayContaining([
    { imageUrl: first.url, opacity: "1" },
    { imageUrl: second.url, opacity: "1" }
  ]));

  await expect(stage).toHaveAttribute("data-slideshow-transitioning", "false", { timeout: 1500 });
  await expect(page.locator(`.frame[data-image-url="${second.url}"]`)).toHaveCSS("opacity", "1");
  await expect(page.locator(`.frame[data-image-url="${first.url}"]`)).toHaveCSS("opacity", "0");
});

test("remote splash dismisses into preview-first layout and arrow next advances slide", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:first",
          type: "text",
          label: "Intro",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:second",
          type: "text",
          label: "Prayer",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:first": { text: "Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:second": { text: "Slide Two", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/remote`);
  await expect(page.locator("#splashTitle")).toContainText(/Mass Presentation|No presentation/i);
  await dismissRemoteSplash(page);
  await expect(page.locator("#titleSection")).toHaveCount(0);
  await expect(page.locator("#previewDock")).toBeVisible();
  await expect(page.locator("#previewCarousel")).toBeVisible();

  await page.keyboard.press("ArrowRight");

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return json.currentSlideIndex;
  }).toBe(1);
});

test("remote selecting a post-mass slide starts the post-mass loop from that slide", async ({ page, request }) => {
  const organizerRes = await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:mass",
          type: "text",
          label: "Homily Notes",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:post-one",
          type: "text",
          label: "Post One",
          phase: "post",
          backgroundTheme: "dark",
          durationSec: 1
        },
        {
          id: "text:post-two",
          type: "text",
          label: "Post Two",
          phase: "post",
          backgroundTheme: "dark",
          durationSec: 1
        }
      ],
      manualSlides: {
        "text:mass": { text: "Mass Slide", notes: "", textVAlign: "middle", imageUrl: null },
        "text:post-one": { text: "Post Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:post-two": { text: "Post Slide Two", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });
  expect(organizerRes.ok()).toBeTruthy();

  await page.goto(`${baseUrl}/remote`);
  await dismissRemoteSplash(page);
  await page.getByRole("button", { name: "Post Two" }).evaluate((button) => button.click());

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return {
      currentSlideIndex: json.currentSlideIndex,
      postMassRunning: json.postMassRunning
    };
  }).toEqual({ currentSlideIndex: 2, postMassRunning: true });

  await expect.poll(async () => {
    const res = await request.get(`${baseUrl}/api/state`);
    const json = await res.json();
    return json.currentSlideIndex;
  }, { timeout: 5000 }).toBe(1);

  const stopRes = await request.post(`${baseUrl}/api/post-mass/stop`);
  expect(stopRes.ok()).toBeTruthy();
});

test("remote preview interaction keeps the large preview pinned at the top", async ({ page, request }) => {
  await request.post(`${baseUrl}/api/organizer`, {
    data: {
      sequence: [
        {
          id: "text:first",
          type: "text",
          label: "Intro",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:second",
          type: "text",
          label: "Prayer",
          phase: "mass",
          backgroundTheme: "dark"
        },
        {
          id: "text:third",
          type: "text",
          label: "Dismissal",
          phase: "mass",
          backgroundTheme: "dark"
        }
      ],
      manualSlides: {
        "text:first": { text: "Slide One", notes: "", textVAlign: "middle", imageUrl: null },
        "text:second": { text: "Slide Two", notes: "", textVAlign: "middle", imageUrl: null },
        "text:third": { text: "Slide Three", notes: "", textVAlign: "middle", imageUrl: null }
      }
    }
  });

  await page.goto(`${baseUrl}/remote`);
  await dismissRemoteSplash(page);
  await page.evaluate(() => {
    document.querySelector("#cueList")?.scrollTo({ top: 9999 });
  });
  await page.locator("#carouselTrack").click({ position: { x: 20, y: 20 } });

  const previewBox = await page.locator("#previewDock").boundingBox();
  expect(previewBox).not.toBeNull();
  expect(previewBox.y).toBeLessThan(2);
});

test("controls show a focus ring and a clear disabled state", async ({ page }) => {
  await page.goto(`${baseUrl}/`);
  if (await page.locator("#massLibraryDialog").isVisible()) {
    await page.locator("#massLibraryCloseBtn").click();
  }

  // Keyboard focus draws a visible ring on a button, a select, and an input.
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "a11yProbe";
    host.innerHTML = '<button id="probeBtn">Probe</button><select id="probeSelect"><option>A</option></select>' +
      '<input id="probeInput"><button id="probeDisabled" disabled>Off</button>';
    document.body.appendChild(host);
  });
  for (const id of ["probeBtn", "probeSelect", "probeInput"]) {
    await page.locator(`#${id}`).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await page.locator(`#${id}`).evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(ring.style, `${id} outline style`).not.toBe("none");
    expect(ring.width, `${id} outline width`).toBeGreaterThanOrEqual(2);
  }

  // A disabled button looks different from an enabled one and shows a blocked cursor.
  const states = await page.evaluate(() => {
    const on = getComputedStyle(document.getElementById("probeBtn"));
    const off = getComputedStyle(document.getElementById("probeDisabled"));
    return { onOpacity: Number(on.opacity), offOpacity: Number(off.opacity), cursor: off.cursor };
  });
  expect(states.offOpacity).toBeLessThan(states.onOpacity);
  expect(states.cursor).toBe("not-allowed");
});

test("remote controls keep a 44 px touch target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/remote`);
  for (const selector of ["#blackoutBtn", "#interstitialBtn", "#nextSectionBtn"]) {
    await expect(page.locator(selector)).toHaveCount(0);
  }
  const cue = page.locator(".cue-btn").first();
  if (await cue.count()) {
    expect((await cue.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

test("Duplicate Mass keeps the start clock time across a daylight saving time change", async ({ browser, request }) => {
  const created = await request.post(`${baseUrl}/api/new-mass`, { data: { title: "Daylight Saving Mass" } });
  expect(created.ok()).toBeTruthy();

  const context = await browser.newContext({ timezoneId: "America/Chicago" });
  const page = await context.newPage();
  const cases = [
    ["2026-10-25T10:00", "2026-11-01T10:00"],
    ["2026-03-01T10:00", "2026-03-08T10:00"],
    ["2026-06-07T09:30", "2026-06-14T09:30"]
  ];
  try {
    for (const [startTime, expectedTime] of cases) {
      const setTime = await request.post(`${baseUrl}/api/start-time`, { data: { time: startTime } });
      expect(setTime.ok()).toBeTruthy();

      await page.goto(`${baseUrl}/`);
      if (await page.locator("#massLibraryDialog").isVisible()) {
        await page.locator("#massLibraryCloseBtn").click();
      }
      await page.locator("#duplicateMassBtn").click();
      await expect(page.locator("#duplicateDialog")).toBeVisible();
      await expect(page.locator("#duplicateStartTime")).toHaveValue(expectedTime);
      await page.locator("#duplicateCancelBtn").click();
    }
  } finally {
    await context.close();
    await request.post(`${baseUrl}/api/start-time`, { data: { time: "" } });
  }
});

test("start page validates PIN-gated mass start flow", async ({ page, request }) => {
  const setPin = await request.post(`${baseUrl}/api/start-pin`, {
    data: { pin: "1234" }
  });
  expect(setPin.ok()).toBeTruthy();

  await page.goto(`${baseUrl}/start`);
  await page.fill("#pinInput", "9999");
  await page.click("#startBtn");
  await expect(page.locator("#errorMsg")).toContainText("Incorrect PIN");

  await page.fill("#pinInput", "1234");
  await page.click("#startBtn");
  await page.waitForURL(/\/remote/);
});

test("Sacra Lux can load readings and expose slides in state", async ({ page, request }) => {
  await page.goto(`${baseUrl}/`);
  await expect(page.locator("#status")).toBeVisible();

  const unlockRes = await request.post(`${baseUrl}/api/verify-pin`, {
    data: { pin: "1234" }
  });
  expect(unlockRes.ok()).toBeTruthy();
  const { controlToken } = await unlockRes.json();

  const loadRes = await loadReadingsFolderOverHttp(request, baseUrl, readingsPath, { "x-sacra-control": controlToken });
  expect(loadRes.ok()).toBeTruthy();

  await expect.poll(async () => {
    const stateRes = await request.get(`${baseUrl}/api/state`);
    const json = await stateRes.json();
    return json.presentation.slides.length;
  }).toBeGreaterThan(0);
});
