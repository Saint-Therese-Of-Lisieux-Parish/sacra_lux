const request = require("supertest");

const { createTempHome, startIsolatedServer } = require("../helpers/testHarness");

const RSS_XML = `<rss><channel><item>
<title>Monday of the Thirty-Third Week</title>
<pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate>
<description>
&lt;h4&gt;Reading 1 &lt;a href="https://example.test/r1"&gt;1 Mc 1:10-15&lt;/a&gt;&lt;/h4&gt;
&lt;div&gt;&lt;p&gt;Text one.&lt;/p&gt;&lt;/div&gt;
&lt;h4&gt;Gospel &lt;a href="https://example.test/g"&gt;Lk 18:35-43&lt;/a&gt;&lt;/h4&gt;
&lt;div&gt;&lt;p&gt;Gospel text.&lt;/p&gt;&lt;/div&gt;
</description>
</item></channel></rss>`;

describe("new Mass templates", () => {
  let handle;
  let app;

  beforeAll(async () => {
    jest.resetModules();
    handle = await startIsolatedServer({ port: 0, homeDir: createTempHome("sacra-lux-new-mass-templates-") });
    app = handle.app;
  });

  afterAll(async () => {
    await handle.stop();
  });

  test("lists Fresh Start first, then the named templates", async () => {
    const res = await request(app).get("/api/mass-templates").expect(200);
    expect(res.body.templates.map((t) => t.label)).toEqual([
      "Fresh Start",
      "Daily Mass",
      "Sunday Mass (Ordinary Time)",
      "Sunday Mass (Lent)",
      "Sunday Mass (Pentecost)",
      "Sunday Mass (Advent)",
      "Funeral Mass",
      "Rosary Rally"
    ]);
  });

  test("creates a Mass from the chosen template", async () => {
    const daily = await request(app)
      .post("/api/new-mass")
      .send({ title: "Weekday", templateId: "daily-mass" })
      .expect(200);
    const dailyIds = handle.state?.organizerSequence?.map((i) => i.id)
      ?? (await request(app).get("/api/state")).body.organizerSequence.map((i) => i.id);
    expect(dailyIds).not.toContain("mass-gloria");
    expect(dailyIds).not.toContain("mass-nicene-creed");
    expect(daily.body.organizerCount).toBe(dailyIds.length);

    const fresh = await request(app).post("/api/new-mass").send({ title: "Fresh" }).expect(200);
    expect(fresh.body.organizerCount).toBeGreaterThan(daily.body.organizerCount);

    const rally = await request(app)
      .post("/api/new-mass")
      .send({ title: "Rally", templateId: "rosary-rally" })
      .expect(200);
    expect(rally.body.slideCount).toBeGreaterThan(0);
  });

  test("rejects an unknown template and keeps the current Mass", async () => {
    await request(app).post("/api/new-mass").send({ title: "Keep Me" }).expect(200);
    await request(app).post("/api/new-mass").send({ title: "Nope", templateId: "bogus" }).expect(400);
    const state = (await request(app).get("/api/state")).body;
    expect(state.presentation.title).toBe("Keep Me");
  });

  test("names the Mass from the feed when the RSS import is on", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => RSS_XML }));
    try {
      const res = await request(app)
        .post("/api/new-mass")
        .send({ title: "Ignored Title", useLectionaryRss: true })
        .expect(200);
      expect(res.body.lectionaryReadingsImported).toBe(true);
      expect(res.body.title).toBe("Monday of the Thirty-Third Week");
      expect(res.body.title.length).toBeGreaterThan(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
