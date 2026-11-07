const { endingForSection } = require("./readingEndings");

const USCCB_DAILY_READINGS_RSS_URL = "https://bible.usccb.org/readings.rss";

const SECTION_STEMS = {
  "Reading I": "Reading_I",
  "Reading II": "Reading_II",
  "Reading III": "Reading_III",
  "Reading IV": "Reading_IV",
  "Reading V": "Reading_V",
  "Reading VI": "Reading_VI",
  "Reading VII": "Reading_VII",
  "Responsorial Psalm": "Responsorial_Psalm",
  "Verse Before the Gospel": "Verse_Before_the_Gospel",
  Gospel: "Gospel"
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = String(code).toLowerCase().startsWith("x")
        ? Number.parseInt(String(code).slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10FFFF
        ? String.fromCodePoint(number)
        : _;
    })
    .replace(/&(nbsp|amp|quot|apos|lt|gt);/gi, (_, entity) => ({
      nbsp: " ", amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">"
    })[entity.toLowerCase()]);
}

function plainText(html) {
  return decodeHtml(String(html || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToLines(html) {
  const text = decodeHtml(String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, ""));
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

function sectionFromHeading(heading) {
  const normalized = plainText(heading);
  const reading = normalized.match(/^Reading\s+(\d+|I{1,3}|IV|V|VI{0,2}|VII)\b/i);
  if (reading) {
    const number = /^\d+$/.test(reading[1])
      ? Number(reading[1])
      : ["I", "II", "III", "IV", "V", "VI", "VII"].indexOf(reading[1].toUpperCase()) + 1;
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII"][number - 1];
    return roman ? `Reading ${roman}` : null;
  }
  if (/^Responsorial Psalm\b/i.test(normalized)) return "Responsorial Psalm";
  if (/^(Alleluia|Verse Before the Gospel)\b/i.test(normalized)) return "Verse Before the Gospel";
  if (/^Gospel\b/i.test(normalized)) return "Gospel";
  return null;
}

function passageFromHeading(heading) {
  const match = String(heading || "").match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if (match) return plainText(match[1]);
  const normalized = plainText(heading);
  const section = sectionFromHeading(normalized);
  if (!section) return "";
  const sectionLabels = {
    "Reading I": "Reading\\s+(?:1|I)",
    "Reading II": "Reading\\s+(?:2|II)",
    "Reading III": "Reading\\s+(?:3|III)",
    "Reading IV": "Reading\\s+(?:4|IV)",
    "Reading V": "Reading\\s+(?:5|V)",
    "Reading VI": "Reading\\s+(?:6|VI)",
    "Reading VII": "Reading\\s+(?:7|VII)",
    "Responsorial Psalm": "Responsorial\\s+Psalm",
    "Verse Before the Gospel": "(?:Alleluia|Verse\\s+Before\\s+the\\s+Gospel)",
    Gospel: "Gospel"
  };
  // eslint-disable-next-line security/detect-non-literal-regexp -- the pattern comes from the fixed section map above
  const remainder = normalized.replace(new RegExp(`^${sectionLabels[section]}\\b\\s*`, "i"), "").trim();
  return remainder || section;
}

function extractTag(xml, tagName) {
  // eslint-disable-next-line security/detect-non-literal-regexp -- every caller passes a literal tag name
  const match = String(xml || "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeHtml(match[1]).trim() : "";
}

function parseDailyReadingsRss(rssXml) {
  const items = [...String(rssXml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if (!items.length) throw new Error("The USCCB RSS feed did not contain any readings.");

  const item = items[0][1];
  const title = extractTag(item, "title");
  const description = extractTag(item, "description");
  const documents = [];
  const usedStems = new Map();
  const alternateCounts = new Map();
  const sectionPattern = /<h4\b[^>]*>([\s\S]*?)<\/h4>\s*<div\b[^>]*>([\s\S]*?)<\/div>/gi;

  for (const match of description.matchAll(sectionPattern)) {
    const heading = plainText(match[1]);
    const isAlternate = /^Or\s*:/i.test(heading);
    const previous = documents[documents.length - 1];
    const section = sectionFromHeading(match[1]);
    const alternateSection = isAlternate && previous ? previous.section : section;
    const passage = passageFromHeading(match[1]) || (isAlternate && previous ? previous.passage : "");
    const textLines = htmlToLines(match[2]);
    if ((!alternateSection || !passage || !textLines.length) && !isAlternate) continue;
    if (isAlternate && !previous) continue;

    const baseStem = SECTION_STEMS[alternateSection];
    const seen = (usedStems.get(baseStem) || 0) + 1;
    usedStems.set(baseStem, seen);
    const alternateSeen = (alternateCounts.get(baseStem) || 0) + 1;
    if (isAlternate) alternateCounts.set(baseStem, alternateSeen);
    documents.push({
      stem: isAlternate ? `${baseStem}-alternate_${alternateSeen}` : (seen === 1 ? baseStem : `${baseStem}_${seen}`),
      section: alternateSection,
      passage,
      textLines,
      ending: endingForSection(section)
    });
  }

  if (!title || !documents.length) {
    throw new Error("The USCCB RSS feed did not contain usable readings.");
  }
  return { title, documents };
}

async function fetchUsccbDailyReadings(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("This version of Sacra Lux cannot retrieve USCCB readings.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(USCCB_DAILY_READINGS_RSS_URL, {
      headers: { Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`The USCCB RSS feed returned ${response.status}.`);
    }
    return parseDailyReadingsRss(await response.text());
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The USCCB RSS feed did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  USCCB_DAILY_READINGS_RSS_URL,
  parseDailyReadingsRss,
  fetchUsccbDailyReadings
};
