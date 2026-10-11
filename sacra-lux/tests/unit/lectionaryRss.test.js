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
});
