const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Pagination cache ─────────────────────────────────────────────────────────

// Store pagination results by cache key.
// Each entry is { slides, timestamp }.
// Keep at most 50 entries and evict the oldest first.
const _paginationCache = new Map();
const _PAGINATION_CACHE_MAX = 50;
const _PAGINATION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Cache visual line counts for individual source lines.
// Key format: `${fontSizePx}|${boxWidthPx}|${lineHash}`.
const _visualLineCache = new Map();
const _VISUAL_LINE_CACHE_MAX = 500;

function _hashLines(lines) {
  const hash = crypto.createHash("sha256");
  for (const line of lines) {
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 16);
}

function _hashString(str) {
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 16);
}

function _createPaginationCacheKey(documents, options) {
  const hash = crypto.createHash("sha256");
  for (const doc of documents) {
    hash.update(doc.stem);
    hash.update(String(doc.passage));
    hash.update(doc.textLines.join("\n"));
  }
  hash.update(JSON.stringify({
    fontSizePx: options.fontSizePx,
    readingTextSizePx: options.readingTextSizePx,
    readingTextHeightPx: options.readingTextHeightPx,
    readingLineHeight: options.readingLineHeight,
    readingTextMarginXPx: options.readingTextMarginXPx,
    canvasWidth: options.canvasWidth
  }));
  return hash.digest("hex").slice(0, 24);
}

function _evictOldestCacheEntry(cache, maxSize) {
  if (cache.size >= maxSize) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

function _cleanupExpiredCacheEntries(cache, ttlMs) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - (entry.timestamp || 0) > ttlMs) {
      cache.delete(key);
    }
  }
}

// Clear both pagination caches.
function clearPaginationCache() {
  _paginationCache.clear();
  _visualLineCache.clear();
}

// Liturgical ending responses keyed by section name.
const ENDING_BY_SECTION = {
  "Reading I": null,
  "Reading II": null,
  "Responsorial Psalm": null,
  "Verse Before the Gospel": null,
  "Gospel": null
};

// Preferred display order for organizer insertion.
const SECTION_ORDER = [
  "Reading I",
  "Responsorial Psalm",
  "Reading II",
  "Verse Before the Gospel",
  "Gospel"
];

// Map filename stems to canonical section names.
const STEM_TO_SECTION = {
  Reading_I: "Reading I",
  Responsorial_Psalm: "Responsorial Psalm",
  Reading_II: "Reading II",
  Verse_Before_the_Gospel: "Verse Before the Gospel",
  Gospel: "Gospel"
};

function sectionFromStem(stem) {
  if (STEM_TO_SECTION[stem]) return STEM_TO_SECTION[stem];

  // Handle variants such as "Gospel-alternate_1" -> "Gospel (Alternate 1)".
  for (const [key, canonical] of Object.entries(STEM_TO_SECTION)) {
    if (stem.startsWith(key)) {
      const suffix = stem
        .slice(key.length)
        .replace(/^[-_]+/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return suffix ? `${canonical} (${suffix})` : canonical;
    }
  }

  return stem.replace(/_/g, " ");
}

function sectionSortKey(name) {
  // Match exactly or as a prefix followed by a space.
  const idx = SECTION_ORDER.findIndex(
    (s) => name === s || (name.startsWith(s) && name[s.length] === " ")
  );
  return idx === -1 ? SECTION_ORDER.length : idx;
}

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * Split text lines at hard-break markers (`---` on its own line).
 * Return line-array segments that can be paginated independently.
 */
function splitAtHardBreaks(lines) {
  const HARD_BREAK = /^\s*---\s*$/;
  const segments = [];
  let current = [];

  for (const line of lines) {
    if (HARD_BREAK.test(line)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) segments.push(current);
  // Return the original array as one segment when no markers are present.
  return segments.length > 0 ? segments : [lines];
}

function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

// Match the default CSS reading line-height.
const DEFAULT_LINE_HEIGHT = 1.58;

// The .reading-ending block (shown only on the last page) uses font-size: 0.78em,
// so its em-based properties resolve against 0.78 × parentFontSize:
//   margin-top: 1.4em × 0.78 + padding-top: 0.6em × 0.78 + one text line: 0.78 × lineHeight
// = (1.4 + 0.6 + lineHeight) × 0.78
// We add a small buffer (0.2 ems) for rounding safety.
const ENDING_FONT_SCALE = 0.78;

function endingOverheadEms(lineHeight) {
  return (1.4 + 0.6 + lineHeight) * ENDING_FONT_SCALE + 0.2;
}

// Use a conservative average character-width ratio for common serif fonts.
const AVG_CHAR_WIDTH_RATIO = 0.55;

/**
 * Estimate how many visual lines a source line occupies after wrapping.
 * Memoize identical inputs.
 */
function estimateVisualLines(line, fontSizePx, boxWidthPx) {
  if (!line || line.trim() === "") return 1; // Blank lines still consume one visual line.

  // Build the cache key from geometry and line content.
  const lineHash = _hashString(line);
  const cacheKey = `${fontSizePx}|${boxWidthPx}|${lineHash}`;

  if (_visualLineCache.has(cacheKey)) {
    return _visualLineCache.get(cacheKey);
  }

  const charWidthPx = fontSizePx * AVG_CHAR_WIDTH_RATIO;
  const charsPerLine = Math.max(1, Math.floor(boxWidthPx / charWidthPx));
  const visualLines = Math.max(1, Math.ceil(line.length / charsPerLine));

  _evictOldestCacheEntry(_visualLineCache, _VISUAL_LINE_CACHE_MAX);
  _visualLineCache.set(cacheKey, visualLines);

  return visualLines;
}

/**
 * Count visual lines for an array of source lines.
 */
function countVisualLines(lines, fontSizePx, boxWidthPx) {
  let total = 0;
  for (const line of lines) {
    total += estimateVisualLines(line, fontSizePx, boxWidthPx);
  }
  return total;
}

/**
 * Return the maximum line count that fits on a normal slide.
 */
function estimateLinesPerPage(fontSizePx, readingTextHeightPx, lineHeight) {
  const size = clamp(Number(fontSizePx) || 60, 24, 200);
  const boxHeight = clamp(Number(readingTextHeightPx) || 840, 120, 980);
  const lh = Number(lineHeight) || DEFAULT_LINE_HEIGHT;
  const lineHeightPx = size * lh;
  return clamp(Math.floor(boxHeight / lineHeightPx), 1, 20);
}

/**
 * Return the maximum line count that fits on a slide with an ending block.
 */
function estimateEndingPageLines(fontSizePx, readingTextHeightPx, lineHeight) {
  const size = clamp(Number(fontSizePx) || 60, 24, 200);
  const boxHeight = clamp(Number(readingTextHeightPx) || 840, 120, 980);
  const lh = Number(lineHeight) || DEFAULT_LINE_HEIGHT;
  const lineHeightPx = size * lh;
  const endingPx = size * endingOverheadEms(lh);
  return clamp(Math.floor((boxHeight - endingPx) / lineHeightPx), 1, 20);
}

// Treat each "R." line as the start of a new psalm stanza.
// Give each refrain line its own slide, and paginate verse blocks by
// estimated visual line usage instead of raw source-line count.
function paginatePsalm(lines, limit, fontSizePx = 60, boxWidthPx = 1760) {
  const slides = [];
  let stanza = [];

  function flushStanza() {
    if (!stanza.length) return;
    let bucket = [];
    let bucketVisualLines = 0;

    for (const line of stanza) {
      const lineVisualLines = estimateVisualLines(line, fontSizePx, boxWidthPx);
      if (bucket.length > 0 && bucketVisualLines + lineVisualLines > limit) {
        slides.push(bucket.join("\n"));
        bucket = [];
        bucketVisualLines = 0;
      }
      bucket.push(line);
      bucketVisualLines += lineVisualLines;
    }

    if (bucket.length > 0) {
      slides.push(bucket.join("\n"));
    }

    stanza = [];
  }

  for (const line of lines) {
    if (line.startsWith("R.")) {
      flushStanza();
      // Give the refrain line its own slide.
      slides.push(line);
    } else {
      stanza.push(line);
    }
  }

  flushStanza();
  return slides;
}

// Return true when a line ends a sentence.
function isSentenceEnd(line) {
  return /[.?!:]["\u201d]?\s*$/.test(line.trimEnd());
}

// Paginate narrative readings by paragraph while respecting visual line limits.
function paginateReading(lines, limit = 8, fontSizePx = 60, boxWidthPx = 1760) {
  // Build paragraph blocks by splitting on blank lines.
  const paragraphs = [];
  let current = [];

  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current);

  // Count visual lines for a set of source lines.
  function vLines(arr) {
    return countVisualLines(arr, fontSizePx, boxWidthPx);
  }

  // Find the best sentence-aware cut that stays within the visual limit.
  function visualSentenceAwareCut(arr, visualLimit) {
    // Find how many source lines fit within the visual limit.
    let visualCount = 0;
    let maxSourceIdx = 0;
    for (let i = 0; i < arr.length; i++) {
      visualCount += estimateVisualLines(arr[i], fontSizePx, boxWidthPx);
      if (visualCount > visualLimit) break;
      maxSourceIdx = i + 1;
    }
    if (maxSourceIdx === 0) maxSourceIdx = 1; // Always take at least one line.

    // Scan backward from maxSourceIdx to find a sentence boundary.
    const floor = Math.max(1, Math.floor(maxSourceIdx / 2));
    for (let i = maxSourceIdx - 1; i >= floor; i--) {
      if (isSentenceEnd(arr[i])) return i + 1;
    }
    return maxSourceIdx;
  }

  const slides = [];
  let bucket = [];

  for (const para of paragraphs) {
    // Flush the current bucket when adding the paragraph would overflow.
    if (bucket.length > 0 && vLines([...bucket, ...para]) > limit) {
      // Flush the bucket and prefer a sentence boundary when it is oversized.
      if (vLines(bucket) > limit) {
        let remaining = bucket;
        while (vLines(remaining) > limit) {
          const cut = visualSentenceAwareCut(remaining, limit);
          slides.push(remaining.slice(0, cut).join("\n"));
          remaining = remaining.slice(cut);
        }
        bucket = remaining;
      } else {
        slides.push(bucket.join("\n"));
        bucket = [];
      }
    }

    if (vLines(para) > limit) {
      // Flush the current bucket, then chunk oversized paragraphs at sentence boundaries.
      if (bucket.length > 0) {
        slides.push(bucket.join("\n"));
        bucket = [];
      }
      let remaining = para;
      while (vLines(remaining) > limit) {
        const cut = visualSentenceAwareCut(remaining, limit);
        slides.push(remaining.slice(0, cut).join("\n"));
        remaining = remaining.slice(cut);
      }
      if (remaining.length > 0) bucket.push(...remaining);
    } else {
      bucket.push(...para);
    }
  }

  if (bucket.length > 0) slides.push(bucket.join("\n"));
  return slides;
}

// ------- File parser -------

// Format: first non-empty line = passage reference; blank line; then reading text.
function parseReadingFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);

  // Strip trailing empty lines.
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) return null;

  const passage = lines[0].trim();

  let textStart = 1;
  while (textStart < lines.length && lines[textStart].trim() === "") {
    textStart++;
  }

  return { passage, textLines: lines.slice(textStart) };
}

function loadReadingDocuments(folderPath) {
  const absPath = path.resolve(folderPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Readings folder not found: ${absPath}`);
  }

  const allFiles = fs.readdirSync(absPath);
  const ignoredStems = new Set(["description", "mass_title", "passage_filenames"]);
  const txtFiles = allFiles.filter((f) => {
    if (!f.endsWith(".txt")) return false;
    const stem = path.basename(f, ".txt");
    return !ignoredStems.has(stem);
  });

  let massTitle = null;
  const titlePath = path.join(absPath, "mass_title.txt");
  if (fs.existsSync(titlePath)) {
    massTitle = fs.readFileSync(titlePath, "utf8").trim();
  }

  const sorted = txtFiles.sort((a, b) => {
    const sa = sectionFromStem(path.basename(a, ".txt"));
    const sb = sectionFromStem(path.basename(b, ".txt"));
    return sectionSortKey(sa) - sectionSortKey(sb);
  });

  const documents = [];

  for (const file of sorted) {
    const stem = path.basename(file, ".txt");
    const section = sectionFromStem(stem);
    const parsed = parseReadingFile(path.join(absPath, file));
    if (!parsed) continue;

    documents.push({
      stem,
      section,
      passage: parsed.passage,
      textLines: parsed.textLines,
      ending: ENDING_BY_SECTION[section] ?? null
    });
  }

  return {
    title: massTitle,
    folderPath: absPath,
    documents
  };
}

function paginateDocuments(documents, options = {}) {
  // Check pagination cache first
  const cacheKey = _createPaginationCacheKey(documents, options);

  _cleanupExpiredCacheEntries(_paginationCache, _PAGINATION_CACHE_TTL_MS);

  if (_paginationCache.has(cacheKey)) {
    const cached = _paginationCache.get(cacheKey);
    return cached.slides;
  }

  // Use reading-specific font size if set, otherwise fall back to global.
  const readingSize = Number(options.readingTextSizePx) || 0;
  const fontSizePx = readingSize > 0 ? readingSize : (Number(options.fontSizePx) || 60);
  const lineHeight = Number(options.readingLineHeight) || DEFAULT_LINE_HEIGHT;

  // Compute text box width for visual line-wrap estimation.
  // Default: 1920px canvas minus 2 × 80px margins = 1760px.
  const canvasWidth = Number(options.canvasWidth) || 1920;
  const marginX = clamp(Number(options.readingTextMarginXPx) || 80, 0, 260);
  const boxWidthPx = canvasWidth - (marginX * 2);

  const slides = [];

  for (const doc of documents) {
    const hasEnding = doc.ending != null;
    const visualLimit = estimateLinesPerPage(fontSizePx, options.readingTextHeightPx, lineHeight);
    const isPsalm = /psalm|responsorial/i.test(doc.section);

    // Split at hard-break markers first; auto-page each segment independently.
    // A "---" line in the source file forces a new slide at that exact point,
    // then autopaging resumes normally within the following segment.
    const segments = splitAtHardBreaks(doc.textLines);
    const pages = [];
    for (const segment of segments) {
      const segPages = isPsalm
        ? paginatePsalm(segment, visualLimit, fontSizePx, boxWidthPx)
        : paginateReading(segment, visualLimit, fontSizePx, boxWidthPx);
      pages.push(...segPages);
    }

    // For readings with a liturgical ending, ensure the last page has few
    // enough visual lines for the ending block to fit without overflow.
    if (hasEnding && pages.length > 0) {
      const endingLimit = estimateEndingPageLines(fontSizePx, options.readingTextHeightPx, lineHeight);
      if (endingLimit < visualLimit) {
        const lastIdx = pages.length - 1;
        const lastLines = pages[lastIdx].split("\n");
        const lastVisualLines = countVisualLines(lastLines, fontSizePx, boxWidthPx);
        if (lastVisualLines > endingLimit) {
          // Trim source lines from the end of the last page until visual lines fit.
          // Push overflow into new page(s) inserted just before it.
          let keepCount = lastLines.length;
          while (keepCount > 1 && countVisualLines(lastLines.slice(lastLines.length - keepCount), fontSizePx, boxWidthPx) > endingLimit) {
            keepCount--;
          }
          const overflowLines = lastLines.slice(0, lastLines.length - keepCount);
          pages[lastIdx] = lastLines.slice(lastLines.length - keepCount).join("\n");
          // Chunk overflow at normal capacity and insert before the last page.
          while (overflowLines.length > 0) {
            // Take lines until we hit the visual limit.
            let chunkEnd = 0;
            let vCount = 0;
            while (chunkEnd < overflowLines.length) {
              const lv = estimateVisualLines(overflowLines[chunkEnd], fontSizePx, boxWidthPx);
              if (vCount + lv > visualLimit && chunkEnd > 0) break;
              vCount += lv;
              chunkEnd++;
            }
            const chunk = overflowLines.splice(0, chunkEnd);
            pages.splice(pages.length - 1, 0, chunk.join("\n"));
          }
        }
      }
    }

    if (pages.length === 0) continue;

    const totalPages = pages.length;

    for (let i = 0; i < pages.length; i++) {
      const pageNumber = i + 1;
      const isLastPage = i === pages.length - 1;

      const title =
        totalPages > 1
          ? `${doc.section} — ${doc.passage} (${pageNumber}/${totalPages})`
          : `${doc.section} — ${doc.passage}`;

      slides.push({
        id: `reading-${doc.stem}-p${pageNumber}`,
        type: "reading",
        title,
        text: pages[i],
        readingSection: doc.section,
        passage: doc.passage,
        pageNumber,
        totalPages,
        isFirstPage: i === 0,
        isLastPage,
        ending: isLastPage ? doc.ending : null,
        notes: ""
      });
    }
  }

  return slides;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Import all readings from a folder.
 * Return { title, folderPath, documents, slides }.
 */
function importReadings(folderPath, options = {}) {
  const loaded = loadReadingDocuments(folderPath);
  const slides = paginateDocuments(loaded.documents, options);
  return {
    title: loaded.title,
    folderPath: loaded.folderPath,
    documents: loaded.documents,
    slides
  };
}

module.exports = {
  importReadings,
  paginateDocuments,
  clearPaginationCache
};
