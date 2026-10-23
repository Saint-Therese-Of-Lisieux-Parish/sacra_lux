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
      statements: 83,
      branches: 68,
      functions: 92,
      lines: 84
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
