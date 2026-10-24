const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  // Keep snapshot names free of the project name so the committed Chromium
  // screenshots keep matching.
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      // The phone remote also runs in WebKit with an iPhone viewport.
      name: "remote-webkit",
      testMatch: /workflows\.spec\.js/,
      grep: /workflows\.spec\.js.* remote /,
      use: { ...devices["iPhone 13"] }
    }
  ]
});
