module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/jestWebStorageShim.js"],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  // src/main.js is the Electron entry point. The packaged-app smoke test covers it, not Jest.
  collectCoverageFrom: ["src/**/*.js", "!src/main.js"],
  coverageReporters: ["text-summary", "lcov"],
  coverageThreshold: {
    global: {
      statements: 81,
      branches: 66,
      functions: 90,
      lines: 83
    },
    "./src/security.js": {
      lines: 90,
      branches: 80
    },
    "./src/massDocument.js": {
      lines: 97,
      branches: 85
    },
    "./src/atomicWrite.js": {
      lines: 90,
      branches: 80
    }
  }
};
