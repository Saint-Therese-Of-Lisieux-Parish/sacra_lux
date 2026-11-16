// Starting organizer sequences for the Create New Mass dialog.
// Each template returns a fresh array so callers can change it safely.

const FRESH_START_ID = "fresh-start";

function item(id, type, label, phase, durationSec = 10) {
  return { id, type, label, phase, backgroundTheme: "dark", durationSec };
}

function interstitial(n) {
  return item(`mass-interstitial-${n}`, "interstitial", "Interstitial", "mass");
}

function freshStartSequence() {
  return [
    item("pre-announcements", "text", "Sacra Lux", "pre", 30),
    item("gathering-countdown", "countdown", "30-Second Timer", "gathering", 30),
    item("mass-title", "text", "Mass Title", "mass"),
    item("mass-opening-hymn", "hymn", "Opening Hymn", "mass"),
    interstitial(1),
    item("mass-gloria", "hymn", "Gloria", "mass"),
    interstitial(2),
    item("mass-reading-1", "reading", "First Reading", "mass"),
    interstitial(3),
    item("mass-psalm", "reading", "Psalm", "mass"),
    interstitial(4),
    item("mass-reading-2", "reading", "Second Reading", "mass"),
    interstitial(5),
    item("mass-gospel-acclamation", "hymn", "Gospel Acclamation", "mass"),
    interstitial(6),
    item("mass-gospel", "reading", "Gospel", "mass"),
    interstitial(7),
    item("mass-nicene-creed", "prayer", "Nicene Creed", "mass"),
    interstitial(8),
    item("mass-offertory", "hymn", "Offertory Hymn", "mass"),
    interstitial(9),
    item("mass-lords-prayer", "prayer", "The Lord's Prayer", "mass"),
    interstitial(10),
    item("mass-communion", "hymn", "Communion Hymn", "mass"),
    interstitial(11),
    item("mass-recessional", "hymn", "Recessional Hymn", "mass"),
    interstitial(12),
    item("post-announcements", "text", "Sacra Lux", "post", 30)
  ];
}

// Drop the item with the given id and the interstitial that follows it.
function dropWithInterstitial(sequence, id) {
  const index = sequence.findIndex((entry) => entry.id === id);
  if (index < 0) return sequence;
  const removeCount = sequence[index + 1]?.type === "interstitial" ? 2 : 1;
  sequence.splice(index, removeCount);
  return sequence;
}

function insertAfterItem(sequence, afterId, ...entries) {
  const index = sequence.findIndex((entry) => entry.id === afterId);
  if (index < 0) return sequence;
  sequence.splice(index + 1, 0, ...entries);
  return sequence;
}

function relabel(sequence, id, label) {
  const entry = sequence.find((candidate) => candidate.id === id);
  if (entry) entry.label = label;
  return sequence;
}

function dailyMassSequence() {
  const sequence = freshStartSequence();
  for (const id of ["mass-gloria", "mass-reading-2", "mass-nicene-creed"]) {
    dropWithInterstitial(sequence, id);
  }
  return sequence;
}

function lentSequence() {
  const sequence = dropWithInterstitial(freshStartSequence(), "mass-gloria");
  return relabel(sequence, "mass-gospel-acclamation", "Lenten Gospel Acclamation");
}

function adventSequence() {
  return dropWithInterstitial(freshStartSequence(), "mass-gloria");
}

function pentecostSequence() {
  return insertAfterItem(
    freshStartSequence(),
    "mass-reading-2",
    interstitial("seq-1"),
    item("mass-sequence", "hymn", "Pentecost Sequence", "mass")
  );
}

function funeralSequence() {
  const sequence = freshStartSequence();
  for (const id of ["mass-gloria", "mass-nicene-creed"]) {
    dropWithInterstitial(sequence, id);
  }
  insertAfterItem(
    sequence,
    "mass-communion",
    interstitial("fc-1"),
    item("mass-final-commendation", "prayer", "Final Commendation", "mass")
  );
  return relabel(sequence, "mass-recessional", "Song of Farewell");
}

function rosaryRallySequence() {
  const sequence = [
    item("pre-announcements", "text", "Sacra Lux", "pre", 30),
    item("gathering-countdown", "countdown", "30-Second Timer", "gathering", 30),
    item("mass-title", "text", "Rosary Rally", "mass"),
    item("rosary-opening-hymn", "hymn", "Opening Hymn", "mass"),
    interstitial(1),
    item("rosary-apostles-creed", "prayer", "Apostles' Creed", "mass"),
    interstitial(2)
  ];
  for (let n = 1; n <= 5; n += 1) {
    sequence.push(
      item(`rosary-mystery-${n}`, "text", `Mystery ${n}`, "mass"),
      interstitial(2 + n)
    );
  }
  sequence.push(
    item("rosary-hail-holy-queen", "prayer", "Hail, Holy Queen", "mass"),
    interstitial(8),
    item("rosary-closing-hymn", "hymn", "Closing Hymn", "mass"),
    item("post-announcements", "text", "Sacra Lux", "post", 30)
  );
  return sequence;
}

const MASS_TEMPLATES = [
  { id: FRESH_START_ID, label: "Fresh Start", build: freshStartSequence },
  { id: "daily-mass", label: "Daily Mass", build: dailyMassSequence },
  { id: "sunday-ordinary-time", label: "Sunday Mass (Ordinary Time)", build: freshStartSequence },
  { id: "sunday-lent", label: "Sunday Mass (Lent)", build: lentSequence },
  { id: "sunday-pentecost", label: "Sunday Mass (Pentecost)", build: pentecostSequence },
  { id: "sunday-advent", label: "Sunday Mass (Advent)", build: adventSequence },
  { id: "funeral-mass", label: "Funeral Mass", build: funeralSequence },
  { id: "rosary-rally", label: "Rosary Rally", build: rosaryRallySequence }
];

function listMassTemplates() {
  return MASS_TEMPLATES.map(({ id, label }) => ({ id, label }));
}

function findMassTemplate(id) {
  return MASS_TEMPLATES.find((template) => template.id === id) || null;
}

module.exports = { FRESH_START_ID, listMassTemplates, findMassTemplate };
