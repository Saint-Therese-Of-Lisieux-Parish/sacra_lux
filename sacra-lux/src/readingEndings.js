// Liturgical ending responses keyed by section name.
const WORD_OF_THE_LORD = "The Word of the Lord.";

const ENDING_BY_SECTION = {
  "Reading I": WORD_OF_THE_LORD,
  "Reading II": WORD_OF_THE_LORD,
  "Reading III": WORD_OF_THE_LORD,
  "Reading IV": WORD_OF_THE_LORD,
  "Reading V": WORD_OF_THE_LORD,
  "Reading VI": WORD_OF_THE_LORD,
  "Reading VII": WORD_OF_THE_LORD,
  "Epistle": WORD_OF_THE_LORD,
  "Responsorial Psalm": WORD_OF_THE_LORD,
  "Verse Before the Gospel": null,
  "Gospel": "The Gospel of the Lord."
};

// Display labels that the organizer shows in place of the section name.
const ENDING_BY_LABEL = {
  "First Reading": WORD_OF_THE_LORD,
  "Second Reading": WORD_OF_THE_LORD,
  "Third Reading": WORD_OF_THE_LORD,
  "Fourth Reading": WORD_OF_THE_LORD,
  "Fifth Reading": WORD_OF_THE_LORD,
  "Sixth Reading": WORD_OF_THE_LORD,
  "Seventh Reading": WORD_OF_THE_LORD,
  "Psalm": WORD_OF_THE_LORD
};

/**
 * Return the spoken ending for a section name or display label.
 * A variant suffix such as " (Alternate 1)" does not change the ending.
 */
function endingForSection(section) {
  const text = String(section || "");
  const splitAt = text.indexOf(" (");
  const base = splitAt === -1 ? text : text.slice(0, splitAt);
  if (Object.hasOwn(ENDING_BY_SECTION, base)) return ENDING_BY_SECTION[base];
  if (Object.hasOwn(ENDING_BY_LABEL, base)) return ENDING_BY_LABEL[base];
  return null;
}

module.exports = { endingForSection };
