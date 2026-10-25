const fc = require("fast-check");

const {
  ValidationError,
  buildMassDocumentFromState,
  buildRuntimeStateFromMassDocument,
  isMassDocumentV3,
  validateMassDocument
} = require("../../src/massDocument");

const HOSTILE_KEYS = ["__proto__", "constructor", "prototype"];

// A document that stays valid for any generated text.
const textItemArbitrary = fc.record({
  kind: fc.constantFrom("text", "prayer", "hymn"),
  section: fc.constantFrom("pre", "gathering", "mass", "post"),
  label: fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0),
  text: fc.string({ maxLength: 200 })
});

const documentArbitrary = fc.record({
  title: fc.string({ minLength: 1, maxLength: 60 }).filter((value) => value.trim().length > 0),
  items: fc.array(textItemArbitrary, { maxLength: 8 })
}).map(({ title, items }) => ({
  format: "sacra-lux.mass",
  version: 3,
  metadata: { title },
  items: items.map((item, index) => ({
    id: `item-${index}`,
    kind: item.kind,
    label: item.label,
    section: item.section,
    content: { text: item.text }
  }))
}));

describe("mass document fuzzing", () => {
  test("the validator throws only ValidationError for any JSON value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        try {
          validateMassDocument(value);
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
        }
        expect(typeof isMassDocumentV3(value)).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  test("the validator throws only ValidationError for near-valid documents with random fields", () => {
    const mutation = fc.record({
      key: fc.constantFrom("metadata", "items", "assets", "presentationDefaults", "version", "format", "extra"),
      value: fc.jsonValue()
    });
    fc.assert(
      fc.property(documentArbitrary, mutation, (document, { key, value }) => {
        try {
          validateMassDocument({ ...document, [key]: value });
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
        }
      }),
      { numRuns: 300 }
    );
  });

  test("hostile keys in mass.json do not change Object.prototype", () => {
    const payloads = HOSTILE_KEYS.flatMap((key) => {
      const hostile = `{"${key}":{"polluted":true}}`;
      return [
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"items":[],${hostile.slice(1, -1)}}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T",${hostile.slice(1, -1)}},"items":[]}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"assets":${hostile},"items":[]}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"presentationDefaults":${hostile},"items":[]}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"items":[{"id":"a","kind":"text","label":"A","section":"mass","content":{"text":"x"},${hostile.slice(1, -1)}}]}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"items":[{"id":"a","kind":"text","label":"A","section":"mass","content":{"text":"x",${hostile.slice(1, -1)}}}]}`,
        `{"format":"sacra-lux.mass","version":3,"metadata":{"title":"T"},"items":[{"id":"a","kind":"text","label":"A","section":"mass","presentation":${hostile},"content":{"text":"x"}}]}`
      ];
    });

    for (const payload of payloads) {
      const document = JSON.parse(payload);
      try {
        buildRuntimeStateFromMassDocument(document);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
      expect({}.polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();
    }
  });

  test("a serialized valid document is accepted after a runtime round trip", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        expect(() => validateMassDocument(document)).not.toThrow();

        const runtime = buildRuntimeStateFromMassDocument(document);
        const rebuilt = buildMassDocumentFromState({
          presentation: { title: runtime.presentationTitle },
          massStartTime: runtime.massStartTime,
          screenSettings: runtime.screenSettings,
          organizerSequence: runtime.organizerSequence,
          manualSlides: runtime.manualSlides,
          readingsSource: { documents: runtime.documents }
        });

        expect(() => validateMassDocument(JSON.parse(JSON.stringify(rebuilt)))).not.toThrow();
      }),
      { numRuns: 200 }
    );
  });
});
