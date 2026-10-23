module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/jestWebStorageShim.js"],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  // src/main.js is the Electron entry point. The packaged-app smoke test covers it, not Jest.
  collectCoverageFrom: ["src/**/*.js", "!src/main.js"],
  coverageReporters: ["text-summary", "lcov", "json-summary"],
  coverageThreshold: {
    global: {
      statements: 84,
      branches: 69,
      functions: 92,
      lines: 85
    },
    "./src/security.js": {
      lines: 93,
      branches: 81
    },
    "./src/massDocument.js": {
      lines: 97,
      branches: 89
    },
    "./src/atomicWrite.js": {
      lines: 99,
      branches: 99
    }
  }
};
