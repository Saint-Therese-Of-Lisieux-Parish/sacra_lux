const {
  USCCB_DAILY_READINGS_RSS_URL,
  fetchUsccbDailyReadings,
  parseDailyReadingsRss
} = require("../../src/lectionaryRss");

describe("lectionaryRss", () => {
  test("converts the newest USCCB RSS item into reading documents", () => {
    const result = parseDailyReadingsRss(`
      <rss><channel><item>
        <title>Third Sunday of Advent</title>
        <pubDate>Sun, 13 Dec 2026 00:00:00 GMT</pubDate>
        <description>
          &lt;h4&gt;Reading 1 &lt;a href="https://example.test/reading"&gt;Isaiah 61:1-2a, 10-11&lt;/a&gt;&lt;/h4&gt;
          &lt;div class="poetry"&gt;&lt;p&gt;The spirit of the Lord GOD is upon me,&lt;br&gt;because the LORD has anointed me.&lt;/p&gt;&lt;/div&gt;
          &lt;h4&gt;Responsorial Psalm &lt;a href="https://example.test/psalm"&gt;Luke 1:46-48, 49-50, 53-54&lt;/a&gt;&lt;/h4&gt;
          &lt;div class="poetry"&gt;&lt;p&gt;R. My soul rejoices in my God.&lt;br&gt;My soul proclaims the greatness of the Lord.&lt;/p&gt;&lt;/div&gt;
          &lt;h4&gt;Alleluia &lt;a href="https://example.test/verse"&gt;Isaiah 61:1&lt;/a&gt;&lt;/h4&gt;
          &lt;div class="poetry"&gt;&lt;p&gt;R. Alleluia, alleluia.&lt;br&gt;The Spirit of the Lord is upon me.&lt;/p&gt;&lt;/div&gt;
          &lt;h4&gt;Gospel &lt;a href="https://example.test/gospel"&gt;John 1:6-8, 19-28&lt;/a&gt;&lt;/h4&gt;
          &lt;div class="poetry"&gt;&lt;p&gt;A man named John was sent from God.&lt;/p&gt;&lt;/div&gt;
        </description>
      </item></channel></rss>
    `);

    expect(result.title).toBe("Third Sunday of Advent");
    expect(result.readingDate).toBe("2026-12-13");
    expect(result.documents).toEqual([
      expect.objectContaining({ stem: "Reading_I", section: "Reading I", passage: "Isaiah 61:1-2a, 10-11" }),
      expect.objectContaining({ stem: "Responsorial_Psalm", section: "Responsorial Psalm" }),
      expect.objectContaining({ stem: "Verse_Before_the_Gospel", section: "Verse Before the Gospel" }),
      expect.objectContaining({ stem: "Gospel", section: "Gospel", passage: "John 1:6-8, 19-28" })
    ]);
    expect(result.documents[0].textLines).toEqual([
      "The spirit of the Lord GOD is upon me,",
      "because the LORD has anointed me."
    ]);
  });

  test("rejects feeds with no readable items", () => {
    expect(() => parseDailyReadingsRss("<rss><channel /></rss>"))
      .toThrow("did not contain any readings");
  });

  test("retrieves readings only from the configured USCCB feed", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => `
        <rss><channel><item><title>Sample Mass</title><description>
          &lt;h4&gt;Gospel &lt;a href="https://example.test/gospel"&gt;John 1:1&lt;/a&gt;&lt;/h4&gt;
          &lt;div&gt;&lt;p&gt;In the beginning was the Word.&lt;/p&gt;&lt;/div&gt;
        </description></item></channel></rss>`
    });

    const result = await fetchUsccbDailyReadings(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(USCCB_DAILY_READINGS_RSS_URL, expect.objectContaining({
      headers: expect.objectContaining({ Accept: expect.stringContaining("application/rss+xml") })
    }));
    expect(result.documents[0]).toEqual(expect.objectContaining({
      section: "Gospel",
      passage: "John 1:1"
    }));
  });

  describe("error paths and parsing branches", () => {
    const wrap = (description, title = "Sample Mass") => `
      <rss><channel><item><title>${title}</title><description>${description}</description></item></channel></rss>`;
    const section = (heading, passage, body) =>
      `&lt;h4&gt;${heading} &lt;a href="https://example.test"&gt;${passage}&lt;/a&gt;&lt;/h4&gt;&lt;div&gt;&lt;p&gt;${body}&lt;/p&gt;&lt;/div&gt;`;

    test("rejects an item with no usable sections", () => {
      expect(() => parseDailyReadingsRss(wrap("No headings here")))
        .toThrow("did not contain usable readings");
    });

    test("rejects an item with no title", () => {
      expect(() => parseDailyReadingsRss(wrap(section("Gospel", "John 1:1", "Text"), "")))
        .toThrow("did not contain usable readings");
    });

    test("skips unknown headings, empty bodies, and out-of-range reading numbers", () => {
      const result = parseDailyReadingsRss(wrap([
        section("Commentary", "Note 1", "Ignored"),
        "&lt;h4&gt;Gospel&lt;/h4&gt;&lt;div&gt;&lt;p&gt;&amp;nbsp;&lt;/p&gt;&lt;/div&gt;",
        section("Reading 9", "Acts 9:1", "Out of range"),
        section("Reading 1", "Acts 1:1", "&amp;nbsp;"),
        section("Gospel", "John 3:16", "Kept")
      ].join("")));
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).toMatchObject({ stem: "Gospel", passage: "John 3:16", textLines: ["Kept"] });
    });

    test("numbers the stems of repeated sections", () => {
      const result = parseDailyReadingsRss(wrap([
        section("Gospel", "Mark 1:1", "One"),
        section("Gospel", "Mark 2:1", "Two")
      ].join("")));
      expect(result.documents.map((doc) => doc.stem)).toEqual(["Gospel", "Gospel_2"]);
    });

    test("maps Reading 2 and a Verse Before the Gospel heading", () => {
      const result = parseDailyReadingsRss(wrap([
        section("Reading 2", "Romans 8:1", "Second"),
        section("Verse Before the Gospel", "Psalm 1:1", "Verse")
      ].join("")));
      expect(result.documents.map((doc) => doc.section)).toEqual(["Reading II", "Verse Before the Gospel"]);
    });

    test("maps Roman numeral readings and alternate readings", () => {
      const result = parseDailyReadingsRss(wrap([
        "&lt;h4&gt;Reading I&lt;/h4&gt;&lt;div&gt;&lt;p&gt;First&lt;/p&gt;&lt;/div&gt;",
        "&lt;h4&gt;Reading II&lt;/h4&gt;&lt;div&gt;&lt;p&gt;Second&lt;/p&gt;&lt;/div&gt;",
        "&lt;h4&gt;Or:&lt;/h4&gt;&lt;div&gt;&lt;p&gt;Alternate second&lt;/p&gt;&lt;/div&gt;"
      ].join("")));
      expect(result.documents.map((doc) => doc.stem)).toEqual([
        "Reading_I", "Reading_II", "Reading_II-alternate_1"
      ]);
      expect(result.documents[2]).toMatchObject({ section: "Reading II", passage: "Reading II", textLines: ["Alternate second"] });
    });

    test("uses unlinked headings as passages", () => {
      const result = parseDailyReadingsRss(wrap([
        "&lt;h4&gt;Alleluia See Te Deum&lt;/h4&gt;&lt;div&gt;&lt;p&gt;Verse&lt;/p&gt;&lt;/div&gt;",
        "&lt;h4&gt;Alleluia&lt;/h4&gt;&lt;div&gt;&lt;p&gt;Plain verse&lt;/p&gt;&lt;/div&gt;"
      ].join("")));
      expect(result.documents.map((doc) => doc.passage)).toEqual(["See Te Deum", "Verse Before the Gospel"]);
    });

    test("decodes numeric and hexadecimal character references", () => {
      const result = parseDailyReadingsRss(wrap(section("Gospel", "John 1:1", "A&amp;#233; B&amp;#xE9; &amp;lt;ok&amp;gt;")));
      expect(result.documents[0].textLines).toEqual(["A\u00e9 B\u00e9 <ok>"]);
    });

    test("keeps an out-of-range numeric character reference as text", () => {
      const result = parseDailyReadingsRss(wrap(section("Reading 1", "Genesis 1:1", "Text &amp;#1114112;")));
      expect(result.documents[0].textLines).toEqual(["Text &#1114112;"]);
    });

    test("fails when no fetch implementation exists", async () => {
      await expect(fetchUsccbDailyReadings(null)).rejects.toThrow("cannot retrieve USCCB readings");
    });

    test("fails on a non-OK response", async () => {
      const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 });
      await expect(fetchUsccbDailyReadings(fetchImpl)).rejects.toThrow("returned 503");
    });

    test("reports a timeout when the request aborts", async () => {
      const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
      const fetchImpl = jest.fn().mockRejectedValue(abort);
      await expect(fetchUsccbDailyReadings(fetchImpl)).rejects.toThrow("did not respond in time");
    });

    test("passes other network errors through", async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error("network down"));
      await expect(fetchUsccbDailyReadings(fetchImpl)).rejects.toThrow("network down");
    });
  });
});
